// Popup UI for batch bookmark export (ADR 0002, Phase B). The background
// owns the job; this module only starts/controls it and polls BATCH_STATUS
// for progress — the popup can close and reopen mid-job without losing
// anything.
//
// The section is always visible so the feature is discoverable; the start
// button is only enabled on x.com/i/bookmarks. While the popup is open on
// the bookmarks page, the count is re-polled so scrolling the page behind
// the popup updates the "(N new)" label live. "N new" excludes bookmarks a
// previous job already exported (the background's ledger); Reset clears
// that memory.

import type {
  BatchStartResponse,
  BatchStatusResponse,
  BookmarksHarvestResponse,
} from '../types/messages';
import { hostMatches } from '../shared/media';
// Pure module (no chrome.* at import time) — safe to share with the popup.
import { EXPORTED_LEDGER_KEY, statusIdOf } from '../background/batch-state';
import {
  batchBarFill,
  batchDedupRow,
  batchDedupText,
  batchProgress,
  batchProgressText,
  batchSection,
  btnBatch,
  btnBatchCancel,
  btnBatchLabel,
  btnBatchPause,
  btnBatchReset,
} from './dom';

type JobSnapshot = NonNullable<BatchStatusResponse['job']>;

const JOB_POLL_MS = 800;
const COUNT_POLL_MS = 1000;
const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

let jobPollTimer: ReturnType<typeof setInterval> | undefined;
let countPollTimer: ReturnType<typeof setInterval> | undefined;
let bookmarksTabId: number | undefined;

async function fetchJob(): Promise<JobSnapshot | undefined> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      action: 'BATCH_STATUS',
    })) as BatchStatusResponse | undefined;
    return resp?.job;
  } catch {
    return undefined;
  }
}

async function harvest(tabId: number): Promise<string[]> {
  try {
    const resp = (await chrome.tabs.sendMessage(tabId, {
      action: 'XCLIPPER_BOOKMARKS_HARVEST',
    })) as BookmarksHarvestResponse | undefined;
    return resp?.urls ?? [];
  } catch {
    // Injector not present (page needs a reload after extension update).
    return [];
  }
}

async function loadLedgerSet(): Promise<Set<string>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(EXPORTED_LEDGER_KEY, (result) => {
      const raw = result[EXPORTED_LEDGER_KEY];
      resolve(new Set(Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : []));
    });
  });
}

function isBookmarksUrl(url: string): boolean {
  if (!hostMatches(url, 'x.com', 'www.x.com')) return false;
  try {
    return new URL(url).pathname.startsWith('/i/bookmarks');
  } catch {
    return false;
  }
}

// "Export bookmarks (N new)" — N excludes already-exported items. The dedup
// row appears once anything is being skipped, with the Reset escape hatch.
async function refreshCount(): Promise<void> {
  if (bookmarksTabId === undefined) return;
  const urls = await harvest(bookmarksTabId);
  const ledger = await loadLedgerSet();
  const fresh = urls.filter((u) => {
    const id = statusIdOf(u);
    return !id || !ledger.has(id);
  });
  const skipped = urls.length - fresh.length;
  const suffix = skipped > 0 ? ` (${fresh.length} ${t('batch_new', 'new')})` : ` (${fresh.length})`;
  btnBatchLabel.textContent = t('btn_batch', 'Export bookmarks') + suffix;
  btnBatch.disabled = fresh.length === 0;
  batchDedupRow.classList.toggle('hidden', skipped === 0);
  if (skipped > 0) {
    batchDedupText.textContent = `${skipped} ${t('batch_already_exported', 'already exported')}`;
  }
}

function render(job: JobSnapshot): void {
  batchProgress.classList.remove('hidden');
  const processed = job.completed + job.failed;
  const pct = job.total > 0 ? Math.round((processed / job.total) * 100) : 0;
  batchBarFill.style.width = `${pct}%`;

  const active = job.status === 'running' || job.status === 'paused';
  btnBatch.classList.toggle('hidden', active);
  // refreshCount() re-evaluates the dedup row once the job is over.
  if (active) batchDedupRow.classList.add('hidden');
  btnBatchPause.classList.toggle('hidden', !active);
  btnBatchCancel.classList.toggle('hidden', !active);
  btnBatchPause.textContent =
    job.status === 'paused' ? t('batch_resume', 'Resume') : t('batch_pause', 'Pause');

  const failedSuffix =
    job.failed > 0 ? ` · ${job.failed} ${t('batch_failed', 'failed')}` : '';
  if (job.status === 'running') {
    batchProgressText.textContent = `${processed}/${job.total}${failedSuffix}`;
  } else if (job.status === 'paused') {
    batchProgressText.textContent = `${t('batch_paused', 'Paused')} — ${processed}/${job.total}${failedSuffix}`;
  } else {
    const label = job.status === 'done' ? t('batch_done', 'Done') : t('batch_stopped', 'Stopped');
    batchProgressText.textContent = `${label} — ${job.completed} ${t('batch_exported', 'exported')}${failedSuffix}`;
  }
}

function stopJobPolling(): void {
  if (jobPollTimer !== undefined) {
    clearInterval(jobPollTimer);
    jobPollTimer = undefined;
  }
}

function startJobPolling(): void {
  stopJobPolling();
  jobPollTimer = setInterval(async () => {
    const job = await fetchJob();
    if (!job) {
      stopJobPolling();
      return;
    }
    render(job);
    if (job.status === 'done' || job.status === 'cancelled') {
      stopJobPolling();
      await backToIdle();
    }
  }, JOB_POLL_MS);
}

function stopCountPolling(): void {
  if (countPollTimer !== undefined) {
    clearInterval(countPollTimer);
    countPollTimer = undefined;
  }
}

function startCountPolling(): void {
  stopCountPolling();
  if (bookmarksTabId === undefined) return;
  countPollTimer = setInterval(() => void refreshCount(), COUNT_POLL_MS);
}

// Job finished/stopped: bring the start button back and resume live counts.
async function backToIdle(): Promise<void> {
  if (bookmarksTabId === undefined) return;
  btnBatch.classList.remove('hidden');
  await refreshCount();
  startCountPolling();
}

async function control(controlAction: 'pause' | 'resume' | 'cancel'): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ action: 'BATCH_CONTROL', control: controlAction });
  } catch {
    // background unreachable — next poll will reflect reality
  }
  const job = await fetchJob();
  if (job) render(job);
}

async function startExport(): Promise<void> {
  if (bookmarksTabId === undefined) return;
  btnBatch.disabled = true;
  stopCountPolling();
  const urls = await harvest(bookmarksTabId);
  const resp = (await chrome.runtime.sendMessage({
    action: 'BATCH_START',
    urls,
  })) as BatchStartResponse | undefined;
  if (!resp?.success) {
    batchProgress.classList.remove('hidden');
    batchProgressText.textContent = resp?.error || t('batch_start_failed', 'Could not start the batch.');
    await backToIdle();
    return;
  }
  const job = await fetchJob();
  if (job) render(job);
  startJobPolling();
}

export async function initBatchUi(): Promise<void> {
  btnBatch.addEventListener('click', () => void startExport());
  btnBatchCancel.addEventListener('click', () => void control('cancel'));
  btnBatchPause.addEventListener('click', () => {
    const resuming = btnBatchPause.textContent === t('batch_resume', 'Resume');
    void control(resuming ? 'resume' : 'pause');
    if (resuming) startJobPolling();
  });
  btnBatchReset.addEventListener('click', () => {
    chrome.storage.local.remove(EXPORTED_LEDGER_KEY, () => void refreshCount());
  });

  // Always visible for discoverability; the start button only works on the
  // bookmarks page itself.
  batchSection.classList.remove('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onBookmarks = !!tab?.id && isBookmarksUrl(tab.url || '');
  if (onBookmarks) bookmarksTabId = tab.id;

  const job = await fetchJob();
  const jobActive = job && (job.status === 'running' || job.status === 'paused');

  if (jobActive && job) {
    render(job);
    btnBatch.classList.add('hidden');
    startJobPolling();
    return;
  }

  if (onBookmarks) {
    await refreshCount();
    startCountPolling();
  } else {
    btnBatch.disabled = true;
    btnBatch.setAttribute(
      'data-tooltip',
      t('btn_batch_open_bookmarks', 'Open x.com/i/bookmarks to batch-export your bookmarks.')
    );
  }
}
