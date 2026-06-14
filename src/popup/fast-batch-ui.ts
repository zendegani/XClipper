// Fast Batch (ADR 0003) popup control. The red toggle above Export settings
// both grants consent (the optional webRequest permission, which can only be
// requested from a user gesture) and arms Fast mode. While armed, the export
// area glows red and the Bookmarks tab's Export button routes to the GraphQL
// path (batch-ui calls startFastExport). Progress is polled from the background
// (FAST_BATCH_STATUS) and rendered into the shared batch progress bar.
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
  batchBarFill,
  batchProgress,
  batchProgressText,
  btnBatch,
  btnBatchCancel,
  btnBatchPause,
  chkFastBatch,
  fastBatchBar,
  fastLockedHint,
  fastDateRange,
  fastDateFrom,
  fastDateTo,
  fastDateClear,
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
const FAST_MODE_KEY = 'fastBatchMode';
const FAST_FROM_KEY = 'fastDateFrom';
const FAST_TO_KEY = 'fastDateTo';
const FAST_POLL_MS = 800;
const batchControls = document.querySelector('.batch-controls');

let fastMode = false;
let fastActive = false;
let inBatchMode = false;
// True while a Standard (worker-tab) batch job is running/paused — reported by
// batch-ui. We lock the toggle whenever EITHER session is active so the two
// can't overlap and the toggle can never disagree with the running session.
let standardJobActive = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

export function getFastMode(): boolean {
  return fastMode;
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
  const red = inBatchMode && (fastActive || (fastMode && !standardJobActive));
  viewMain?.classList.toggle('fast-on', red);
  // The date-range filter + step lights are Fast-only — show whenever armed.
  const showExtras = fastMode && inBatchMode;
  fastDateRange?.classList.toggle('hidden', !showExtras);
  fastSteps?.classList.toggle('hidden', !showExtras);
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
  if (chkFastBatch) chkFastBatch.disabled = locked;
  fastBatchBar?.classList.toggle('locked', locked);
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

// Called by mode.ts when the Single/Batch tab flips: the bar + glow only make
// sense in Batch mode.
export function syncFastBatchMode(single: boolean): void {
  inBatchMode = !single;
  fastBatchBar?.classList.toggle('hidden', single);
  if (single) fastLockedHint?.classList.add('hidden');
  updateToggleLock();
  applyGlow();
}

function setFastMode(on: boolean): void {
  fastMode = on;
  if (chkFastBatch) chkFastBatch.checked = on;
  chrome.storage.local.set({ [FAST_MODE_KEY]: on });
  applyGlow();
  notifyChanged();
}

export function initFastBatchUi(): void {
  if (!chkFastBatch) return;

  // Restore the armed state, but only if the permission is still granted
  // (the user could have revoked it in chrome://extensions).
  chrome.storage.local.get(FAST_MODE_KEY, (res) => {
    if (res[FAST_MODE_KEY] !== true) return;
    chrome.permissions.contains(ACCESS, (granted) => {
      if (granted) setFastMode(true);
      else setFastMode(false);
    });
  });

  // Clicking the toggle while it's locked doesn't fire `change` (disabled
  // input), but the label still gets the click — surface the reason then.
  chkFastBatch.closest('.fast-toggle')?.addEventListener('click', () => {
    if (chkFastBatch.disabled) showLockHint();
  });

  chkFastBatch.addEventListener('change', () => {
    if (!chkFastBatch.checked) {
      setFastMode(false);
      return;
    }
    // Arming: ensure consent. contains() avoids a needless prompt; request()
    // must run in this gesture. A denial reverts the checkbox.
    chrome.permissions.contains(ACCESS, (has) => {
      if (has) {
        setFastMode(true);
        return;
      }
      chrome.permissions.request(ACCESS, (granted) => {
        void chrome.runtime.lastError; // swallow benign gesture/denial errors
        setFastMode(!!granted);
      });
    });
  });

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
}

// ─── Fast export run + progress polling ──────────────────────────────

export async function startFastExport(
  source: 'bookmarks' | 'profile' | 'likes',
  handle?: string
): Promise<void> {
  btnBatch.disabled = true;
  // Optional date range; swap if the user entered them backwards.
  let fromDate = fastDateFrom?.value || undefined;
  let toDate = fastDateTo?.value || undefined;
  if (fromDate && toDate && fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  // Expand threads + articles by default (correctness over raw speed).
  const resp = (await chrome.runtime.sendMessage({
    action: 'FAST_BATCH_START',
    source,
    ...(handle ? { handle } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    expandThreads: true,
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
  batchControls?.classList.toggle('hidden', !running);
  btnBatchCancel.classList.toggle('hidden', !running);
  btnBatchPause.classList.add('hidden'); // Fast Batch has no pause

  // Total is unknown while collecting (indeterminate) — peg the bar to a low
  // value so it's visibly "working" without implying a fraction.
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : running ? 8 : 100;
  batchBarFill.style.width = `${pct}%`;

  if (running) stepsFromProgress(p);

  const who = fastWho(p);
  const prefix = who ? `${who} · ` : '';
  if (running) {
    batchProgressText.textContent =
      p.total > 0 ? `${prefix}${p.phase} ${p.done}/${p.total}` : `${prefix}${p.phase} ${p.done}`;
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
