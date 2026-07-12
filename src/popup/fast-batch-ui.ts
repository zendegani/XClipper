// Fast Batch (ADR 0003) popup control. The Batch engine selector (Manual | Auto |
// Super) chooses the acquisition path: Auto and Super run through the GraphQL
// session (this module); Manual routes to the Standard worker-tab batch. Picking
// Auto/Super grants consent (the optional webRequest permission, requestable only
// from a click gesture) and turns the export area red; the Bookmarks/Profile/Likes
// Export button then routes to startFastExport. Progress is polled from the
// background (FAST_BATCH_STATUS) and rendered into the shared batch status line.
//
// Decoupled from batch-ui via DOM events: this module never imports batch-ui
// (batch-ui imports the small query helpers here), so there's no cycle.

import type {
  FastBatchProgress,
  FastBatchReadyResponse,
  FastBatchStartResponse,
  FastBatchStatusResponse,
} from '../types/messages';
import {
  batchProgress,
  batchProgressText,
  btnBatch,
  btnBatchCancel,
  btnBatchPause,
  batchModeField,
  batchMode,
  batchModeCaption,
  batchModeInfo,
  modeManual,
  modeAuto,
  modeSuper,
  fastLockedHint,
  fastDateRange,
  fastDateFrom,
  fastDateTo,
  fastDateClear,
  fastPaginate,
  fastPaginateRecent,
  fastPaginateResume,
  fastPaginateDaterange,
  fastPaginateCaption,
  fastSteps,
  fastStepPage,
  fastStepTweet,
  fastStepFetch,
  fastStepExpand,
  viewMain,
} from './dom';

type StepState = 'ready' | 'missing' | 'active' | 'done' | 'pending';
function setStep(el: HTMLElement | undefined, state: StepState, tooltip = ''): void {
  if (!el) return;
  el.dataset.state = state;
  if (tooltip) el.setAttribute('data-tooltip', tooltip);
  else el.removeAttribute('data-tooltip');
}

const ACCESS: chrome.permissions.Permissions = { permissions: ['webRequest'], origins: ['*://x.com/*'] };
// The chosen engine, persisted. Manual = Standard worker-tab batch; Auto = Fast
// Batch (GraphQL); Super = Fast Batch without thread expansion (#85). Replaces
// the old fastBatchMode + fastSuperMode on/off flags (migrated on restore).
type BatchMode = 'manual' | 'auto' | 'super';
const BATCH_MODE_KEY = 'batchMode';
const FAST_MODE_KEY = 'fastBatchMode'; // legacy — read once to migrate
const FAST_SUPER_KEY = 'fastSuperMode'; // legacy — read once to migrate
const FAST_FROM_KEY = 'fastDateFrom';
const FAST_TO_KEY = 'fastDateTo';
const FAST_PAGINATE_KEY = 'fastPaginateMode';
const FAST_POLL_MS = 800;
const batchControls = document.querySelector('.batch-controls');
const batchProgressRow = document.querySelector('.batch-progress-row');

// Always-on caption under the selector: scroll mode + quality for each engine.
const MODE_CAPTION: Record<BatchMode, { key: string; text: string }> = {
  manual: { key: 'mode_caption_manual', text: 'You scroll the page; every post you load is saved. Full threads & articles.' },
  auto: { key: 'mode_caption_auto', text: 'Fetches through your X session automatically — no scrolling. Full threads & articles.' },
  super: { key: 'mode_caption_super', text: "Fetches thousands at once, but saves each post's first tweet only — threads skipped." },
};

// Caption under the fetch-mode segment, explaining the picked option
// (PaginateMode is declared with the run state below).
const PAGINATE_CAPTION: Record<PaginateMode, { key: string; text: string }> = {
  recent: { key: 'fast_caption_recent', text: 'Scans the top of the feed — newly-added posts since your last run.' },
  resume: { key: 'fast_caption_resume', text: 'Continues a deep backfill from where the last Resume run stopped.' },
  dateRange: { key: 'fast_caption_daterange', text: "Only posts tweeted in the window below; scans deep without moving Resume's position." },
};
const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

let engineMode: BatchMode = 'manual';
let fastActive = false;
let inBatchMode = false;
// 'recent' (top), 'resume' (continue from saved cursor), or 'dateRange' (deep
// scan for a tweet-date window, without moving the resume cursor) — #83.
type PaginateMode = 'recent' | 'resume' | 'dateRange';
let paginateMode: PaginateMode = 'recent';
// True while a Standard (worker-tab) batch job is running/paused — reported by
// batch-ui. We lock the selector whenever EITHER session is active so the two
// can't overlap and the selector can never disagree with the running session.
let standardJobActive = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

export function getFastMode(): boolean {
  return engineMode !== 'manual';
}
export function isFastActive(): boolean {
  return fastActive;
}

// batch-ui listens for this to re-evaluate the export button (mode armed/disarmed
// or a fast run finished).
function notifyChanged(): void {
  window.dispatchEvent(new Event('xclipper-fast-changed'));
}

// The red recolor follows the ACTIVE session, not the toggle: red while a Fast
// run is in flight (or idle-and-armed), but blue whenever a Standard job is the
// active one — so a job started in the other mode never shows the wrong color.
function applyGlow(): void {
  const red = inBatchMode && (fastActive || (getFastMode() && !standardJobActive));
  viewMain?.classList.toggle('fast-on', red);
  // The fetch-mode segment + step lights are Auto/Super-only — show when armed.
  // The date inputs belong to Date-range fetch mode only.
  const showExtras = getFastMode() && inBatchMode;
  fastPaginate?.classList.toggle('hidden', !showExtras);
  fastDateRange?.classList.toggle('hidden', !(showExtras && paginateMode === 'dateRange'));
  fastSteps?.classList.toggle('hidden', !showExtras);
}

// Apply + persist the chosen engine (no permission handling — see selectMode).
function setBatchMode(mode: BatchMode): void {
  engineMode = mode;
  modeManual?.classList.toggle('active', mode === 'manual');
  modeAuto?.classList.toggle('active', mode === 'auto');
  modeSuper?.classList.toggle('active', mode === 'super');
  if (batchModeCaption) batchModeCaption.textContent = t(MODE_CAPTION[mode].key, MODE_CAPTION[mode].text);
  // The (i) with the rate-limit / re-run note is Auto/Super-only — Manual never
  // touches the X session, so it has no such caveat.
  batchModeInfo?.classList.toggle('hidden', mode === 'manual');
  chrome.storage.local.set({ [BATCH_MODE_KEY]: mode });
  applyGlow();
  notifyChanged();
}

// A user click on an engine segment. Locked mid-run → just show the reason.
// Manual needs nothing; Auto/Super need the opt-in webRequest permission —
// contains() first to avoid a needless prompt, request() inside this gesture,
// and a denial falls back to Manual.
function selectMode(mode: BatchMode): void {
  if (standardJobActive || fastActive) {
    showLockHint();
    return;
  }
  if (mode === 'manual') {
    setBatchMode('manual');
    return;
  }
  chrome.permissions.contains(ACCESS, (has) => {
    if (has) {
      setBatchMode(mode);
      return;
    }
    chrome.permissions.request(ACCESS, (granted) => {
      void chrome.runtime.lastError; // swallow benign gesture/denial errors
      setBatchMode(granted ? mode : 'manual');
    });
  });
}

function setPaginateMode(mode: PaginateMode): void {
  paginateMode = mode;
  fastPaginateRecent?.classList.toggle('active', mode === 'recent');
  fastPaginateResume?.classList.toggle('active', mode === 'resume');
  fastPaginateDaterange?.classList.toggle('active', mode === 'dateRange');
  if (fastPaginateCaption) fastPaginateCaption.textContent = t(PAGINATE_CAPTION[mode].key, PAGINATE_CAPTION[mode].text);
  chrome.storage.local.set({ [FAST_PAGINATE_KEY]: mode });
  applyGlow(); // reveal/hide the date inputs for the new mode
}

// Step lights when idle: Page/Tweet show readiness (what to do before Export);
// Fetch/Expand are pending. During a run, render() drives them by phase.
export async function updateFastSteps(source: 'bookmarks' | 'profile' | 'likes'): Promise<void> {
  if (fastActive) return; // a run owns the steps (see render)
  let r: FastBatchReadyResponse | undefined;
  try {
    r = (await chrome.runtime.sendMessage({ action: 'FAST_BATCH_READY', source })) as
      | FastBatchReadyResponse
      | undefined;
  } catch {
    return;
  }
  setStep(fastStepPage, r?.feed ? 'ready' : 'missing', r?.feed ? '' : 'Reload this page so its feed request is captured');
  setStep(fastStepTweet, r?.tweetDetail ? 'ready' : 'missing', r?.tweetDetail ? '' : 'Open any one tweet so threads & articles can be expanded');
  setStep(fastStepFetch, 'pending');
  setStep(fastStepExpand, 'pending');
}

function stepsFromProgress(p: FastBatchProgress): void {
  setStep(fastStepPage, 'done');
  setStep(fastStepTweet, 'done');
  const phase = p.phase || '';
  setStep(fastStepFetch, phase.startsWith('Fetching') ? 'active' : 'done');
  setStep(fastStepExpand, phase.startsWith('Expanding') ? 'active' : phase.startsWith('Writing') ? 'done' : 'pending');
}

// Lock the toggle (can't switch modes mid-export) while either session runs.
// The "why" hint is NOT shown just because something's running — only when the
// user actually tries to flip the locked toggle (see the click handler).
function updateToggleLock(): void {
  const locked = standardJobActive || fastActive;
  batchMode?.classList.toggle('locked', locked);
  // aria-disabled (not the `disabled` attribute) so a locked click still fires
  // and can surface the "why" hint via selectMode.
  for (const b of [modeManual, modeAuto, modeSuper]) b?.setAttribute('aria-disabled', String(locked));
  if (!locked) fastLockedHint?.classList.add('hidden'); // clear once unlocked
}

// Reveal the locked reason only on an actual attempt to toggle while locked.
function showLockHint(): void {
  if (inBatchMode) fastLockedHint?.classList.remove('hidden');
}

// Called by batch-ui as the Standard job starts/stops.
export function setStandardJobActive(active: boolean): void {
  standardJobActive = active;
  updateToggleLock();
  applyGlow();
}

// Called by mode.ts when the Single/Batch tab flips: the selector + glow only
// make sense in Batch mode.
export function syncFastBatchMode(single: boolean): void {
  inBatchMode = !single;
  batchModeField?.classList.toggle('hidden', single);
  if (single) fastLockedHint?.classList.add('hidden');
  updateToggleLock();
  applyGlow();
}

export function initFastBatchUi(): void {
  if (!batchMode) return;

  // Restore the saved engine, migrating the old two-flag Fast/Super state.
  // Auto/Super only stick if the webRequest permission is still granted (the
  // user could have revoked it in chrome://extensions).
  chrome.storage.local.get([BATCH_MODE_KEY, FAST_MODE_KEY, FAST_SUPER_KEY], (res) => {
    let mode: BatchMode = 'manual';
    const saved = res[BATCH_MODE_KEY];
    if (saved === 'manual' || saved === 'auto' || saved === 'super') mode = saved;
    else if (res[FAST_MODE_KEY] === true) mode = res[FAST_SUPER_KEY] === true ? 'super' : 'auto';
    if (mode === 'manual') {
      setBatchMode('manual');
      return;
    }
    chrome.permissions.contains(ACCESS, (granted) => setBatchMode(granted ? mode : 'manual'));
  });

  // Engine segments. selectMode handles the lock hint + Auto/Super consent.
  modeManual?.addEventListener('click', () => selectMode('manual'));
  modeAuto?.addEventListener('click', () => selectMode('auto'));
  modeSuper?.addEventListener('click', () => selectMode('super'));

  // Date-range filter: restore, persist on change, and clear.
  chrome.storage.local.get([FAST_FROM_KEY, FAST_TO_KEY], (res) => {
    if (fastDateFrom && typeof res[FAST_FROM_KEY] === 'string') fastDateFrom.value = res[FAST_FROM_KEY];
    if (fastDateTo && typeof res[FAST_TO_KEY] === 'string') fastDateTo.value = res[FAST_TO_KEY];
  });
  fastDateFrom?.addEventListener('change', () =>
    chrome.storage.local.set({ [FAST_FROM_KEY]: fastDateFrom.value })
  );
  fastDateTo?.addEventListener('change', () =>
    chrome.storage.local.set({ [FAST_TO_KEY]: fastDateTo.value })
  );
  fastDateClear?.addEventListener('click', () => {
    if (fastDateFrom) fastDateFrom.value = '';
    if (fastDateTo) fastDateTo.value = '';
    chrome.storage.local.set({ [FAST_FROM_KEY]: '', [FAST_TO_KEY]: '' });
  });

  // Recent | Resume | Date range fetch mode: restore, then toggle on click.
  chrome.storage.local.get(FAST_PAGINATE_KEY, (res) => {
    const m = res[FAST_PAGINATE_KEY];
    setPaginateMode(m === 'resume' || m === 'dateRange' ? m : 'recent');
  });
  fastPaginateRecent?.addEventListener('click', () => setPaginateMode('recent'));
  fastPaginateResume?.addEventListener('click', () => setPaginateMode('resume'));
  fastPaginateDaterange?.addEventListener('click', () => setPaginateMode('dateRange'));
}

// ─── Fast export run + progress polling ──────────────────────────────

export async function startFastExport(
  source: 'bookmarks' | 'profile' | 'likes',
  handle?: string
): Promise<void> {
  btnBatch.disabled = true;
  // The date window applies only in Date-range mode; swap if entered backwards.
  const dateMode = paginateMode === 'dateRange';
  let fromDate = dateMode ? fastDateFrom?.value || undefined : undefined;
  let toDate = dateMode ? fastDateTo?.value || undefined : undefined;
  if (fromDate && toDate && fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  // Auto expands threads + articles (correctness over raw speed); Super trades
  // thread expansion for a much larger per-run item budget (#85).
  const resp = (await chrome.runtime.sendMessage({
    action: 'FAST_BATCH_START',
    source,
    ...(handle ? { handle } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    expandThreads: engineMode !== 'super',
    paginate: paginateMode,
  })) as FastBatchStartResponse | undefined;
  if (!resp?.success) {
    showProgress(resp?.error || 'Could not start Fast Batch.');
    return;
  }
  fastActive = true;
  updateToggleLock();
  applyGlow();
  startPolling();
}

export async function cancelFast(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ action: 'FAST_BATCH_CANCEL' });
  } catch {
    // background unreachable — the next poll reflects reality
  }
}

function showProgress(text: string): void {
  batchProgress.classList.remove('hidden');
  batchProgressText.textContent = text;
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startPolling(): void {
  stopPolling();
  void poll();
  pollTimer = setInterval(() => void poll(), FAST_POLL_MS);
}

async function poll(): Promise<void> {
  let progress: FastBatchProgress | undefined;
  try {
    const resp = (await chrome.runtime.sendMessage({
      action: 'FAST_BATCH_STATUS',
    })) as FastBatchStatusResponse | undefined;
    progress = resp?.progress;
  } catch {
    return;
  }
  if (!progress) return;
  render(progress);
  if (progress.status !== 'running') {
    stopPolling();
    fastActive = false;
    updateToggleLock(); // unlock the toggle now the run is done
    applyGlow();
    notifyChanged(); // batch-ui re-enables the export button
  }
}

// Whose/which Fast export — shown so progress stays meaningful after navigating.
function fastWho(p: FastBatchProgress): string {
  if (p.source === 'profile' && p.handle) return `@${p.handle}`;
  if (p.source === 'bookmarks') return 'Bookmarks';
  if (p.source === 'likes') return 'Likes';
  return '';
}

function render(p: FastBatchProgress): void {
  batchProgress.classList.remove('hidden');
  const running = p.status === 'running';
  // On an error (e.g. preconditions not met) show only the message — no bar,
  // which would otherwise look like a finished run.
  batchProgressRow?.classList.toggle('hidden', p.status === 'error');
  batchControls?.classList.toggle('hidden', !running);
  btnBatchCancel.classList.toggle('hidden', !running);
  btnBatchPause.classList.add('hidden'); // Fast Batch has no pause

  // No determinate bar for Fast Batch (hidden via #view-main.fast-on .batch-bar):
  // collection is open-ended and Super Fast streams writes in parallel, so a
  // fraction would be fake. The count text + step lights carry progress instead.
  if (running) stepsFromProgress(p);

  const who = fastWho(p);
  const prefix = who ? `${who} · ` : '';
  if (running) {
    // While collecting (total unknown) a deep Resume crawl pages past already-
    // exported items with done stuck at 0 — show the skipped count so it reads
    // as working, not stuck.
    const tail = p.total > 0 ? ` ${p.done}/${p.total}` : ` ${p.done}${p.skipped ? ` · ${p.skipped} skipped` : ''}`;
    batchProgressText.textContent = `${prefix}${p.phase}${tail}`;
  } else if (p.status === 'done' || p.status === 'cancelled') {
    const label = p.status === 'cancelled' ? 'Cancelled' : 'Done';
    const skipped = p.skipped ? ` · ${p.skipped} skipped` : '';
    const limited = p.rateLimited ? ' · rate-limited — re-run for the rest' : '';
    batchProgressText.textContent = `${prefix}${label} — ${p.exported} exported${skipped}${limited}`;
  } else if (p.status === 'error') {
    batchProgressText.textContent = p.error || 'Fast Batch failed';
  }
}

// On popup (re)open, resume showing a Fast run that's still going in the
// background — the popup is a fresh page, so its state was lost. Returns true if
// a run is in progress (caller forces Batch mode so the bar is visible).
export async function resumeFastIfActive(): Promise<boolean> {
  let p: FastBatchProgress | undefined;
  try {
    const resp = (await chrome.runtime.sendMessage({
      action: 'FAST_BATCH_STATUS',
    })) as FastBatchStatusResponse | undefined;
    p = resp?.progress;
  } catch {
    return false;
  }
  if (p?.status !== 'running') return false;
  fastActive = true;
  updateToggleLock();
  applyGlow();
  startPolling();
  return true;
}
