// Popup UI for batch export (ADR 0002, Phases B–C). The background owns the
// job; this module only starts/controls it and polls BATCH_STATUS for
// progress — the popup can close and reopen mid-job without losing anything.
//
// Layout: a Bookmarks | Profile | Likes | Selection icon-tab strip over one
// action button, so every source is always discoverable without stretching
// the popup. A tab's button activates when the current page matches its source
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
import { loadSettings } from '../shared/settings';
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
  btnBatchIconLikes,
  btnBatchLabel,
  btnBatchPause,
  btnBatchReset,
  tabBatchBookmarks,
  tabBatchProfile,
  tabBatchSelection,
  tabBatchLikes,
} from './dom';
import { setExportMode } from './mode';
import { getFastMode, isFastActive, startFastExport, cancelFast, setStandardJobActive } from './fast-batch-ui';

type JobSnapshot = NonNullable<BatchStatusResponse['job']>;
type BatchTab = 'bookmarks' | 'profile' | 'selection' | 'likes';

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
  likes: tabBatchLikes,
};

// Per-tab action-button icons (bookmark, user, check-square, heart) — all
// live in the HTML; the inactive ones are hidden.
const TAB_ICONS: Record<BatchTab, SVGElement> = {
  bookmarks: btnBatchIconBookmarks,
  profile: btnBatchIconProfile,
  selection: btnBatchIconSelection,
  likes: btnBatchIconLikes,
};

let activeTab: BatchTab = 'bookmarks';
// One job at a time (the background enforces this — one worker window,
// politeness throttle toward X). Tabs stay browsable mid-job; this flag
// just keeps the start button disabled everywhere while a job runs, except
// where it can append to that job (see `appendable`).
let jobIsActive = false;
// True when the action button should ADD the loaded items to the running
// job's queue (same-source job in progress) instead of starting a new one.
let appendable = false;
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

// `unreachable` distinguishes "injector didn't respond" (page needs a reload
// after an extension update) from "responded but this isn't a batch source".
type HarvestResult = HarvestResponse & { unreachable?: boolean };

async function harvest(): Promise<HarvestResult> {
  if (pageTabId === undefined) return { source: null, urls: [] };
  try {
    const resp = (await chrome.tabs.sendMessage(pageTabId, {
      action: 'XCLIPPER_HARVEST',
    })) as HarvestResponse | undefined;
    return resp ?? { source: null, urls: [] };
  } catch {
    // Injector not present (page needs a reload after extension update).
    return { source: null, urls: [], unreachable: true };
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
  if (jobIsActive && !appendable) {
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
  appendable = false;

  // Fast Batch (armed via the red toggle) overrides per-page gating: it fetches
  // bookmarks through the GraphQL session, so it doesn't need the bookmarks page
  // loaded. Phase 1 is bookmarks-only — other tabs point back to Bookmarks.
  if (getFastMode()) {
    if (activeTab === 'bookmarks') {
      // Fast can't know up front which bookmarks are already exported (it
      // discovers that mid-run), so show the ledger size + Reset affordance.
      const ledger = await loadLedgerSet();
      batchDedupRow.classList.toggle('hidden', ledger.size === 0);
      if (ledger.size > 0) {
        batchDedupText.textContent = `${ledger.size} ${t('batch_already_exported', 'already exported')}`;
      }
      setButton(
        `⚡ ${t('btn_batch', 'Export bookmarks')}`,
        !isFastActive(),
        t('btn_batch_fast_hint', 'Fetch all your bookmarks through your X session — much faster. Expands threads & articles; stops politely if X rate-limits.')
      );
    } else {
      batchDedupRow.classList.add('hidden');
      setButton(
        `⚡ ${t('btn_batch', 'Export bookmarks')}`,
        false,
        t('btn_batch_fast_only_bookmarks', 'Fast Batch supports bookmarks only for now — switch to the Bookmarks tab, or turn off Fast.')
      );
    }
    return;
  }

  const { source, handle, urls, unreachable } = await harvest();

  // After an extension reload the page still runs the old/no content script
  // (the same situation Single export reports). Every batch source needs it,
  // so surface the same "reload the page" hint rather than a misleading state.
  if (unreachable && pageIsX) {
    batchDedupRow.classList.add('hidden');
    const label =
      activeTab === 'bookmarks' ? t('btn_batch', 'Export bookmarks')
        : activeTab === 'profile' ? t('btn_batch_profile', 'Export posts')
          : activeTab === 'likes' ? t('btn_batch_likes', 'Export likes')
            : t('btn_batch_select', 'Select tweets…');
    // Keep it ENABLED — a disabled button can't show its tooltip in Chrome, so
    // the reason would be invisible. Clicking surfaces the reload hint (like
    // Single export does), which the user found clear.
    setButton(label, true, t('error_reload', 'Reload the page and try again.'));
    return;
  }

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
  if (activeTab === 'likes' && source !== 'likes') {
    batchDedupRow.classList.add('hidden');
    setButton(
      t('btn_batch_likes', 'Export likes'),
      false,
      t('btn_batch_open_likes', 'Open your Likes page on x.com to export the posts you have liked.')
    );
    return;
  }

  // On the running job's own source the button appends loaded items to its
  // queue instead of starting a new job — bookmarks always; a profile only
  // when it's the same handle (a different profile stays disabled).
  const onSameSourceJob =
    jobIsActive &&
    lastJob?.origin === activeTab &&
    (activeTab !== 'profile' || (lastJob?.handle ?? '') === (handle ?? ''));
  appendable = onSameSourceJob;

  // While appending, also exclude what's already in the queue (not just the
  // exported ledger), so the count reflects only items the queue lacks.
  const queued = onSameSourceJob ? new Set(lastJob?.queuedIds ?? []) : undefined;
  const ledger = await loadLedgerSet();
  const fresh = urls.filter((u) => {
    const id = statusIdOf(u);
    return !id || (!ledger.has(id) && !queued?.has(id));
  });
  const skipped = urls.length - fresh.length;
  const base = onSameSourceJob
    ? t('btn_batch_add', 'Add to queue')
    : activeTab === 'profile'
      ? `${t('btn_batch_profile', 'Export posts')}${handle ? ` @${handle}` : ''}`
      : activeTab === 'likes'
        ? t('btn_batch_likes', 'Export likes')
        : t('btn_batch', 'Export bookmarks');
  const suffix = skipped > 0 ? ` (${fresh.length} ${t('batch_new', 'new')})` : ` (${fresh.length})`;
  const tooltip = onSameSourceJob
    ? t('btn_batch_add_hint', 'Add the newly-loaded posts to the running batch queue.')
    : activeTab === 'profile'
      ? t('btn_batch_profile_hint', "Export this profile's own posts loaded on the page as Markdown files into one folder. Reposts are skipped; scroll to load more.")
      : activeTab === 'likes'
        ? t('btn_batch_likes_hint', 'Export every liked post loaded on this page as Markdown files into one folder. Scroll your Likes page to load more.')
        : t('btn_batch_hint', 'Export every bookmark loaded on this page as Markdown files into one folder. Scroll the bookmarks page to load more.');
  setButton(base + suffix, fresh.length > 0, tooltip);
  // The "already exported" note is about past jobs; while appending to a live
  // job the queue-exclusion handles dupes, so hide it there.
  batchDedupRow.classList.toggle('hidden', skipped === 0 || onSameSourceJob);
  if (skipped > 0 && !onSameSourceJob) {
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
  } else if (!isFastActive()) {
    // A running Fast Batch owns the progress bar (its own poller) — don't hide it.
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
  setStandardJobActive(active); // lock the Fast toggle + keep the box blue while Standard runs
  // The start button's enabled state + tooltip are owned entirely by
  // setButton (via refreshIdleUi) — render must not touch them, or the two
  // pollers fight and the button flickers between disabled and append-enabled.
  // The button stays visible so its label keeps counting as the user scrolls;
  // the controls + bar sit below it.
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
    const reason = job.pauseReason ? ` · ${job.pauseReason}` : '';
    batchProgressText.textContent = `${t('batch_paused', 'Paused')} — ${processed}/${job.total}${failedSuffix}${reason}`;
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
  setStandardJobActive(false); // Standard job ended — unlock the Fast toggle
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
  // Armed Fast Batch routes bookmarks through the GraphQL path (own progress
  // poller in fast-batch-ui). Other tabs can't be Fast yet (Phase 1).
  if (getFastMode() && activeTab === 'bookmarks') {
    await startFastExport();
    return;
  }

  if (activeTab === 'selection') {
    if (pageTabId === undefined) return;
    chrome.tabs.sendMessage(pageTabId, { action: 'XCLIPPER_SELECTION', enable: true }, () => {
      if (chrome.runtime.lastError) {
        // Injector gone (page not reloaded after the extension update).
        batchProgress.classList.remove('hidden');
        batchProgressText.textContent = t('error_reload', 'Reload the page and try again.');
        return;
      }
      window.close(); // hand the page over to selection mode
    });
    return;
  }

  btnBatch.disabled = true;
  const { urls, handle, unreachable } = await harvest();
  // Page wasn't reloaded after the extension update → injector unreachable.
  // Show the same hint Single export gives, instead of a misleading failure.
  if (unreachable && pageIsX) {
    batchProgress.classList.remove('hidden');
    batchProgressText.textContent = t('error_reload', 'Reload the page and try again.');
    btnBatch.disabled = false;
    return;
  }
  const settings = await loadSettings();
  const resp = (await chrome.runtime.sendMessage({
    action: 'BATCH_START',
    urls,
    origin: activeTab,
    format: settings.batchFormat,
    output: settings.batchOutput,
    ...(activeTab === 'profile' && handle ? { handle } : {}),
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

// Add the page's freshly-loaded items to the running same-source job. The
// background dedupes against the queue and ledger; we then re-poll so the
// count and progress reflect the longer queue.
async function appendExport(): Promise<void> {
  btnBatch.disabled = true;
  const { urls } = await harvest();
  await chrome.runtime.sendMessage({ action: 'BATCH_APPEND', urls });
  const job = await fetchJob();
  if (job) render(job); // refresh lastJob.queuedIds before recomputing the count
  await refreshIdleUi();
}

export async function initBatchUi(): Promise<void> {
  btnBatch.addEventListener('click', () => void (appendable ? appendExport() : startExport()));
  btnBatchCancel.addEventListener('click', () => void (isFastActive() ? cancelFast() : control('cancel')));
  // Fast toggle armed/disarmed, or a fast run finished → re-evaluate the button.
  window.addEventListener('xclipper-fast-changed', () => void refreshIdleUi());
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

  // Land on the running job's origin tab (so its progress is visible), else the
  // tab matching the current page. The injector reports the source; if it can't
  // (page not reloaded after an extension update), fall back to the URL so we
  // still focus e.g. Bookmarks. Selection is the last resort (any x.com page).
  const { source } = await harvest();
  setActiveTab(activeJob?.origin ?? source ?? sourceFromUrl(tab?.url) ?? (pageIsX ? 'selection' : 'bookmarks'));
}

// Best-effort page type from the URL, for initial tab focus when the injector
// hasn't reported a source yet (e.g. right after an extension reload).
function sourceFromUrl(url: string | undefined): BatchTab | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
  if (path === '/i/bookmarks') return 'bookmarks';
  if (/\/likes$/.test(path)) return 'likes';
  const reserved = new Set(['/home', '/explore', '/notifications', '/messages', '/search', '/settings', '/i', '/compose']);
  if (/^\/[A-Za-z0-9_]{1,15}$/.test(path) && !reserved.has(path)) return 'profile';
  return null;
}
