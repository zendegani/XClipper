// Fast Batch (ADR 0003) popup control. The red toggle above Export settings
// both grants consent (the optional webRequest permission, which can only be
// requested from a user gesture) and arms Fast mode. While armed, the export
// area glows red and the Bookmarks tab's Export button routes to the GraphQL
// path (batch-ui calls startFastExport). Progress is polled from the background
// (FAST_BATCH_STATUS) and rendered into the shared batch progress bar.
//
// Decoupled from batch-ui via DOM events: this module never imports batch-ui
// (batch-ui imports the small query helpers here), so there's no cycle.

import type { FastBatchProgress, FastBatchStartResponse, FastBatchStatusResponse } from '../types/messages';
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
  viewMain,
} from './dom';

const ACCESS: chrome.permissions.Permissions = { permissions: ['webRequest'], origins: ['*://x.com/*'] };
const FAST_MODE_KEY = 'fastBatchMode';
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
}

// Lock the toggle (can't switch modes mid-export) while either session runs.
function updateToggleLock(): void {
  const locked = standardJobActive || fastActive;
  if (chkFastBatch) chkFastBatch.disabled = locked;
  fastBatchBar?.classList.toggle('locked', locked);
  // Visible reason so a disabled toggle doesn't look broken. Only while in
  // Batch mode (the bar is hidden in Single).
  fastLockedHint?.classList.toggle('hidden', !(locked && inBatchMode));
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
}

// ─── Fast export run + progress polling ──────────────────────────────

export async function startFastExport(
  source: 'bookmarks' | 'profile' | 'likes',
  handle?: string
): Promise<void> {
  btnBatch.disabled = true;
  // Expand threads + articles by default (correctness over raw speed).
  const resp = (await chrome.runtime.sendMessage({
    action: 'FAST_BATCH_START',
    source,
    ...(handle ? { handle } : {}),
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

  if (running) {
    batchProgressText.textContent =
      p.total > 0 ? `${p.phase} ${p.done}/${p.total}` : `${p.phase} ${p.done}`;
  } else if (p.status === 'done' || p.status === 'cancelled') {
    const label = p.status === 'cancelled' ? 'Cancelled' : 'Done';
    const skipped = p.skipped ? ` · ${p.skipped} skipped` : '';
    const limited = p.rateLimited ? ' · rate-limited — re-run for the rest' : '';
    batchProgressText.textContent = `${label} — ${p.exported} exported${skipped}${limited}`;
  } else if (p.status === 'error') {
    batchProgressText.textContent = p.error || 'Fast Batch failed';
  }
}
