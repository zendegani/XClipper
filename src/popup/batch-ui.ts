// Popup UI for batch bookmark export (ADR 0002, Phase B). The background
// owns the job; this module only starts/controls it and polls BATCH_STATUS
// for progress — the popup can close and reopen mid-job without losing
// anything.

import type {
  BatchStartResponse,
  BatchStatusResponse,
  BookmarksHarvestResponse,
} from '../types/messages';
import { hostMatches } from '../shared/media';
import {
  batchBarFill,
  batchProgress,
  batchProgressText,
  batchSection,
  btnBatch,
  btnBatchCancel,
  btnBatchLabel,
  btnBatchPause,
} from './dom';

type JobSnapshot = NonNullable<BatchStatusResponse['job']>;

const POLL_MS = 800;
const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

let pollTimer: ReturnType<typeof setInterval> | undefined;
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

function isBookmarksUrl(url: string): boolean {
  if (!hostMatches(url, 'x.com', 'www.x.com')) return false;
  try {
    return new URL(url).pathname.startsWith('/i/bookmarks');
  } catch {
    return false;
  }
}

function setStartLabel(count: number): void {
  btnBatchLabel.textContent = `${t('btn_batch', 'Export bookmarks')} (${count})`;
  btnBatch.disabled = count === 0;
}

function render(job: JobSnapshot): void {
  batchProgress.classList.remove('hidden');
  const processed = job.completed + job.failed;
  const pct = job.total > 0 ? Math.round((processed / job.total) * 100) : 0;
  batchBarFill.style.width = `${pct}%`;

  const active = job.status === 'running' || job.status === 'paused';
  btnBatch.classList.toggle('hidden', active);
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

function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    const job = await fetchJob();
    if (!job) {
      stopPolling();
      return;
    }
    render(job);
    if (job.status === 'done' || job.status === 'cancelled') {
      stopPolling();
      await refreshStartButton();
    }
  }, POLL_MS);
}

async function refreshStartButton(): Promise<void> {
  if (bookmarksTabId === undefined) return;
  btnBatch.classList.remove('hidden');
  setStartLabel((await harvest(bookmarksTabId)).length);
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
  const urls = await harvest(bookmarksTabId);
  if (urls.length === 0) {
    batchProgress.classList.remove('hidden');
    batchProgressText.textContent = t(
      'batch_none_found',
      'No bookmarks loaded — scroll the bookmarks page first.'
    );
    btnBatch.disabled = false;
    return;
  }
  const resp = (await chrome.runtime.sendMessage({
    action: 'BATCH_START',
    urls,
  })) as BatchStartResponse | undefined;
  if (!resp?.success) {
    batchProgress.classList.remove('hidden');
    batchProgressText.textContent = resp?.error || t('batch_start_failed', 'Could not start the batch.');
    btnBatch.disabled = false;
    return;
  }
  const job = await fetchJob();
  if (job) render(job);
  startPolling();
}

export async function initBatchUi(): Promise<void> {
  btnBatch.addEventListener('click', () => void startExport());
  btnBatchCancel.addEventListener('click', () => void control('cancel'));
  btnBatchPause.addEventListener('click', () => {
    const resuming = btnBatchPause.textContent === t('batch_resume', 'Resume');
    void control(resuming ? 'resume' : 'pause');
    if (resuming) startPolling();
  });

  // An active job is shown wherever the popup opens; the start button only
  // appears on the bookmarks page itself.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onBookmarks = !!tab?.id && isBookmarksUrl(tab.url || '');
  if (onBookmarks) bookmarksTabId = tab.id;

  const job = await fetchJob();
  const jobActive = job && (job.status === 'running' || job.status === 'paused');

  if (!onBookmarks && !jobActive) return;
  batchSection.classList.remove('hidden');

  if (jobActive && job) {
    render(job);
    btnBatch.classList.add('hidden');
    startPolling();
  } else if (onBookmarks && bookmarksTabId !== undefined) {
    setStartLabel((await harvest(bookmarksTabId)).length);
  }
}
