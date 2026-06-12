// Popup UI for batch export (ADR 0002, Phases B–C). The background owns the
// job; this module only starts/controls it and polls BATCH_STATUS for
// progress — the popup can close and reopen mid-job without losing anything.
//
// Layout: a Bookmarks | Profile | Selection tab strip over one action
// button, so every source is always discoverable without stretching the
// popup. A tab's button activates when the current page matches its source
// (Selection works on any x.com timeline); otherwise it's disabled with a
// "where to go" hint. While the popup is open on a matching page, the count
// re-polls so scrolling behind the popup updates the "(N new)" label live.
// "N new" excludes items a previous job already exported (the background's
// ledger); Reset clears that memory.

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
  btnBatch,
  btnBatchCancel,
  btnBatchIconBookmarks,
  btnBatchIconProfile,
  btnBatchIconSelection,
  btnBatchLabel,
  btnBatchPause,
  btnBatchReset,
  tabBatchBookmarks,
  tabBatchProfile,
  tabBatchSelection,
} from './dom';
import { setExportMode } from './mode';

type JobSnapshot = NonNullable<BatchStatusResponse['job']>;
type BatchTab = 'bookmarks' | 'profile' | 'selection';

// The pause button swaps between a pause and a play (resume) glyph.
const icoPause = btnBatchPause.querySelector('.batch-ico-pause');
const icoPlay = btnBatchPause.querySelector('.batch-ico-play');
// Hidden as a unit when idle so the bar doesn't keep a leading gap.
const batchControls = document.querySelector('.batch-controls');

const JOB_POLL_MS = 800;
const COUNT_POLL_MS = 1000;
const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

const TAB_BUTTONS: Record<BatchTab, HTMLButtonElement> = {
  bookmarks: tabBatchBookmarks,
  profile: tabBatchProfile,
  selection: tabBatchSelection,
};

// Per-tab action-button icons (bookmark, user, check-square) — all three
// live in the HTML; the inactive ones are hidden.
const TAB_ICONS: Record<BatchTab, SVGElement> = {
  bookmarks: btnBatchIconBookmarks,
  profile: btnBatchIconProfile,
  selection: btnBatchIconSelection,
};

let activeTab: BatchTab = 'bookmarks';
// One job at a time (the background enforces this — one worker window,
// politeness throttle toward X). Tabs stay browsable mid-job; this flag
// just keeps the start button disabled everywhere while a job runs.
let jobIsActive = false;
// Last polled snapshot, so a tab switch can re-evaluate progress visibility
// immediately instead of waiting for the next poll.
let lastJob: JobSnapshot | undefined;
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

function setButton(label: string, enabled: boolean, tooltip: string): void {
  btnBatchLabel.textContent = label;
  if (jobIsActive) {
    btnBatch.disabled = true;
    btnBatch.setAttribute('data-tooltip', t('batch_running', 'A batch job is already running.'));
    return;
  }
  btnBatch.disabled = !enabled;
  btnBatch.setAttribute('data-tooltip', tooltip);
}

// Refresh the action button for the active tab. Counts only apply when the
// current page matches the tab's source; otherwise the button points the
// user at the right page.
async function refreshIdleUi(): Promise<void> {
  if (activeTab === 'selection') {
    batchDedupRow.classList.add('hidden');
    setButton(
      t('btn_batch_select', 'Select tweets…'),
      pageIsX,
      pageIsX
        ? t('btn_batch_select_hint', 'Pick individual tweets on the current page with checkboxes, then export the selection.')
        : t('btn_batch_open_x', 'Open x.com to batch-export bookmarks, a profile, or a selection.')
    );
    return;
  }

  const { source, handle, urls } = await harvest();

  if (activeTab === 'bookmarks' && source !== 'bookmarks') {
    batchDedupRow.classList.add('hidden');
    setButton(
      t('btn_batch', 'Export bookmarks'),
      false,
      t('btn_batch_open_bookmarks', 'Open x.com/i/bookmarks to export your bookmarks.')
    );
    return;
  }
  if (activeTab === 'profile' && source !== 'profile') {
    batchDedupRow.classList.add('hidden');
    setButton(
      t('btn_batch_profile', 'Export posts'),
      false,
      t('btn_batch_open_profile', 'Open a profile page on x.com to export its posts. Reposts are skipped.')
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
    activeTab === 'profile'
      ? `${t('btn_batch_profile', 'Export posts')}${handle ? ` @${handle}` : ''}`
      : t('btn_batch', 'Export bookmarks');
  const suffix = skipped > 0 ? ` (${fresh.length} ${t('batch_new', 'new')})` : ` (${fresh.length})`;
  const tooltip =
    activeTab === 'profile'
      ? t('btn_batch_profile_hint', "Export this profile's own posts loaded on the page as Markdown files into one folder. Reposts are skipped; scroll to load more.")
      : t('btn_batch_hint', 'Export every bookmark loaded on this page as Markdown files into one folder. Scroll the bookmarks page to load more.');
  setButton(base + suffix, fresh.length > 0, tooltip);
  batchDedupRow.classList.toggle('hidden', skipped === 0);
  if (skipped > 0) {
    batchDedupText.textContent = `${skipped} ${t('batch_already_exported', 'already exported')}`;
  }
}

function setActiveTab(tab: BatchTab): void {
  activeTab = tab;
  (Object.keys(TAB_BUTTONS) as BatchTab[]).forEach((k) => {
    TAB_BUTTONS[k].classList.toggle('active', k === tab);
    TAB_ICONS[k].classList.toggle('hidden', k !== tab);
  });
  // Progress and reports belong to the tab the job was started from; other
  // tabs just show their (disabled) start button.
  if (jobIsActive && lastJob) {
    render(lastJob);
  } else {
    batchProgress.classList.add('hidden');
  }
  void refreshIdleUi();
  startCountPolling();
}

function render(job: JobSnapshot): void {
  lastJob = job;
  // Show progress only on the tab the job came from (no origin = legacy
  // job from before origins existed — show everywhere).
  const onOriginTab = !job.origin || job.origin === activeTab;
  batchProgress.classList.toggle('hidden', !onOriginTab);
  const processed = job.completed + job.failed;
  const pct = job.total > 0 ? Math.round((processed / job.total) * 100) : 0;
  batchBarFill.style.width = `${pct}%`;

  const active = job.status === 'running' || job.status === 'paused';
  jobIsActive = active;
  if (active) {
    btnBatch.disabled = true;
    btnBatch.setAttribute('data-tooltip', t('batch_running', 'A batch job is already running.'));
  }
  // Keep the start button visible (disabled) during a job — its label keeps
  // counting items as the user scrolls to load more. The controls + bar sit
  // below it.
  batchControls?.classList.toggle('hidden', !active);
  btnBatchPause.classList.toggle('hidden', !active);
  btnBatchCancel.classList.toggle('hidden', !active);
  const paused = job.status === 'paused';
  icoPlay?.classList.toggle('hidden', !paused);
  icoPause?.classList.toggle('hidden', paused);
  btnBatchPause.setAttribute(
    'aria-label',
    paused ? t('batch_resume', 'Resume') : t('batch_pause', 'Pause')
  );

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
  if (pageTabId === undefined || !pageIsX || activeTab === 'selection') return;
  countPollTimer = setInterval(() => void refreshIdleUi(), COUNT_POLL_MS);
}

// Job finished/stopped: re-enable starting and resume live counts. The
// final report stays visible until the user switches tabs.
async function backToIdle(): Promise<void> {
  jobIsActive = false;
  await refreshIdleUi();
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
  if (activeTab === 'selection') {
    if (pageTabId === undefined) return;
    chrome.tabs.sendMessage(pageTabId, { action: 'XCLIPPER_SELECTION', enable: true }, () => {
      void chrome.runtime.lastError;
      window.close(); // hand the page over to selection mode
    });
    return;
  }

  btnBatch.disabled = true;
  const { urls } = await harvest();
  const resp = (await chrome.runtime.sendMessage({
    action: 'BATCH_START',
    urls,
    origin: activeTab,
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
    const resuming = lastJob?.status === 'paused';
    void control(resuming ? 'resume' : 'pause');
    if (resuming) startJobPolling();
  });
  btnBatchReset.addEventListener('click', () => {
    chrome.storage.local.remove(EXPORTED_LEDGER_KEY, () => void refreshIdleUi());
  });
  (Object.keys(TAB_BUTTONS) as BatchTab[]).forEach((tab) => {
    TAB_BUTTONS[tab].addEventListener('click', () => setActiveTab(tab));
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageIsX = !!tab?.id && hostMatches(tab.url || '', 'x.com', 'www.x.com');
  if (pageIsX) pageTabId = tab!.id;

  const job = await fetchJob();
  const activeJob =
    job && (job.status === 'running' || job.status === 'paused') ? job : undefined;
  if (activeJob) {
    setExportMode(false, false); // reopening mid-job lands on Batch, not Single
    render(activeJob); // sets jobIsActive, so tab setup below keeps Start disabled
    startJobPolling();
  }

  // Land on the running job's origin tab (so its progress is visible), else
  // the tab matching the current page; Selection is the fallback since it
  // works on any x.com timeline.
  const { source } = await harvest();
  setActiveTab(activeJob?.origin ?? source ?? (pageIsX ? 'selection' : 'bookmarks'));
}
