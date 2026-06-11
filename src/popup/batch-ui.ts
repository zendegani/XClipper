// Popup UI for batch export (ADR 0002, Phases B–C). The background owns the
// job; this module only starts/controls it and polls BATCH_STATUS for
// progress — the popup can close and reopen mid-job without losing anything.
//
// The section is always visible so the feature is discoverable. The start
// button activates on harvestable pages (bookmarks, profiles) and the count
// re-polls while the popup is open, so scrolling the page behind the popup
// updates the "(N new)" label live. "N new" excludes items a previous job
// already exported (the background's ledger); Reset clears that memory.
// "Select tweets…" hands off to the injector's selection mode on any
// x.com timeline.

import type {
  BatchStartResponse,
  BatchStatusResponse,
  HarvestResponse,
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
  batchToolsRow,
  btnBatch,
  btnBatchCancel,
  btnBatchLabel,
  btnBatchPause,
  btnBatchReset,
  btnBatchSelect,
} from './dom';

type JobSnapshot = NonNullable<BatchStatusResponse['job']>;

const JOB_POLL_MS = 800;
const COUNT_POLL_MS = 1000;
const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

let jobPollTimer: ReturnType<typeof setInterval> | undefined;
let countPollTimer: ReturnType<typeof setInterval> | undefined;
let pageTabId: number | undefined;
let pageIsX = false;

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

async function harvest(): Promise<HarvestResponse> {
  if (pageTabId === undefined) return { source: null, urls: [] };
  try {
    const resp = (await chrome.tabs.sendMessage(pageTabId, {
      action: 'XCLIPPER_HARVEST',
    })) as HarvestResponse | undefined;
    return resp ?? { source: null, urls: [] };
  } catch {
    // Injector not present (page needs a reload after extension update).
    return { source: null, urls: [] };
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

function disableStart(tooltipKey: string, tooltipFallback: string): void {
  btnBatch.disabled = true;
  btnBatchLabel.textContent = t('btn_batch', 'Export bookmarks');
  btnBatch.setAttribute('data-tooltip', t(tooltipKey, tooltipFallback));
  batchDedupRow.classList.add('hidden');
}

// "Export bookmarks (N new)" / "Export @handle (N new)" — N excludes
// already-exported items. The dedup row appears once anything is being
// skipped, with the Reset escape hatch.
async function refreshCount(): Promise<void> {
  const { source, handle, urls } = await harvest();
  if (!source) {
    disableStart(
      'btn_batch_open_source',
      'Open x.com/i/bookmarks or a profile page to batch-export its posts.'
    );
    return;
  }
  const ledger = await loadLedgerSet();
  const fresh = urls.filter((u) => {
    const id = statusIdOf(u);
    return !id || !ledger.has(id);
  });
  const skipped = urls.length - fresh.length;
  const base =
    source === 'profile' && handle
      ? `${t('btn_batch_profile', 'Export posts')} @${handle}`
      : t('btn_batch', 'Export bookmarks');
  const suffix = skipped > 0 ? ` (${fresh.length} ${t('batch_new', 'new')})` : ` (${fresh.length})`;
  btnBatchLabel.textContent = base + suffix;
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
  batchToolsRow.classList.toggle('hidden', active);
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
  if (pageTabId === undefined || !pageIsX) return;
  countPollTimer = setInterval(() => void refreshCount(), COUNT_POLL_MS);
}

// Job finished/stopped: bring the start controls back and resume live counts.
async function backToIdle(): Promise<void> {
  btnBatch.classList.remove('hidden');
  batchToolsRow.classList.remove('hidden');
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
  btnBatch.disabled = true;
  stopCountPolling();
  const { urls } = await harvest();
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
  btnBatchSelect.addEventListener('click', () => {
    if (pageTabId === undefined) return;
    chrome.tabs.sendMessage(pageTabId, { action: 'XCLIPPER_SELECTION', enable: true }, () => {
      void chrome.runtime.lastError;
      window.close(); // hand the page over to selection mode
    });
  });

  // Always visible for discoverability; the controls only work on x.com.
  batchSection.classList.remove('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageIsX = !!tab?.id && hostMatches(tab.url || '', 'x.com', 'www.x.com');
  if (pageIsX) pageTabId = tab!.id;
  btnBatchSelect.disabled = !pageIsX;

  const job = await fetchJob();
  const jobActive = job && (job.status === 'running' || job.status === 'paused');

  if (jobActive && job) {
    render(job);
    btnBatch.classList.add('hidden');
    batchToolsRow.classList.add('hidden');
    startJobPolling();
    return;
  }

  if (pageIsX) {
    await refreshCount();
    startCountPolling();
  } else {
    disableStart('btn_batch_open_x', 'Open x.com to batch-export bookmarks or a profile.');
  }
}
