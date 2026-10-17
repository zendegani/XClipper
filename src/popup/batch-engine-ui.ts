// Batch engine selector and GraphQL run presentation (ADR 0003). Scroll | Auto Full |
// Auto Fast chooses the acquisition path: Auto Full and Auto Fast run through the GraphQL
// session; Scroll routes to DOM acquisition in a worker window. Picking
// Auto Full/Auto Fast grants consent (the optional webRequest permission, requestable only
// from a click gesture); the Bookmarks/Profile/Likes Export button then routes
// to startGraphqlExport. Progress is polled from the background (FAST_BATCH_STATUS)
// and rendered into the shared batch status line.
//
// Decoupled from batch-ui via DOM events: this module never imports batch-ui
// (batch-ui imports the small query helpers here), so there's no cycle.

import type {
  BatchEngine,
  FetchMode,
  GraphqlBatchSource,
  GraphqlBatchProgress,
  GraphqlBatchReadyResponse,
  GraphqlBatchStartResponse,
  GraphqlBatchStatusResponse,
} from '../types/messages';
import {
  batchProgress,
  batchProgressText,
  btnBatch,
  btnBatchCancel,
  btnBatchPause,
  batchEngineField,
  batchEngineSelector,
  batchEngineCaption,
  batchEngineInfo,
  engineManual,
  engineAuto,
  engineSuper,
  batchRunSummary,
  floodHint,
  floodFix,
  outCombined,
  chkZip,
  fetchDateRange,
  fetchDateFrom,
  fetchDateTo,
  fetchDateClear,
  fetchModeSelector,
  fetchRecent,
  fetchResume,
  fetchDateRangeButton,
  fetchModeCaption,
  graphqlSteps,
  graphqlStepPage,
  graphqlStepTweet,
  graphqlStepFetch,
  graphqlStepExpand,
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
// Keep storage names stable, including the old two-flag engine migration.
const BATCH_ENGINE_KEY = 'batchMode';
const LEGACY_FAST_MODE_KEY = 'fastBatchMode'; // legacy — read once to migrate
const LEGACY_SUPER_MODE_KEY = 'fastSuperMode'; // legacy — read once to migrate
const FROM_DATE_KEY = 'fastDateFrom';
const TO_DATE_KEY = 'fastDateTo';
const FETCH_MODE_KEY = 'fastPaginateMode';
const GRAPHQL_POLL_MS = 800;
const batchControls = document.querySelector('.batch-controls');
const batchProgressRow = document.querySelector('.batch-progress-row');

// Caption under the selector (and each segment's tooltip): scroll mode +
// quality for each engine.
const ENGINE_CAPTION: Record<BatchEngine, { key: string; text: string }> = {
  manual: { key: 'mode_caption_manual', text: 'You scroll and choose what loads. Saves full threads and articles.' },
  auto: { key: 'mode_caption_auto', text: 'No scrolling. Fetches posts with full threads and articles.' },
  super: { key: 'mode_caption_super', text: 'No scrolling. Skips thread expansion for larger, faster exports. Articles and replies to others still expand.' },
};

// Caption under the fetch-mode segment, explaining the picked option.
const FETCH_MODE_CAPTION: Record<FetchMode, { key: string; text: string }> = {
  recent: { key: 'fast_caption_recent', text: 'Scans the top of the feed — newly-added posts since your last run.' },
  resume: { key: 'fast_caption_resume', text: 'Continues a deep backfill from where the last Resume run stopped.' },
  dateRange: { key: 'fast_caption_daterange', text: "Only posts tweeted in the window below; scans deep without moving Resume's position." },
};
const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

// Segment labels, reused for the one-line summary that replaces both selectors
// while a run is active.
const ENGINE_LABEL: Record<BatchEngine, { key: string; text: string }> = {
  manual: { key: 'mode_manual', text: 'Scroll' },
  auto: { key: 'mode_auto', text: 'Auto Full' },
  super: { key: 'mode_super', text: 'Auto Fast' },
};
const FETCH_MODE_LABEL: Record<FetchMode, { key: string; text: string }> = {
  recent: { key: 'fast_paginate_recent', text: 'Recent' },
  resume: { key: 'fast_paginate_resume', text: 'Resume' },
  dateRange: { key: 'fast_date_range', text: 'Date range' },
};

let batchEngine: BatchEngine = 'manual';
let graphqlRunActive = false;
let inBatchMode = false;
// 'recent' (top), 'resume' (continue from saved cursor), or 'dateRange' (deep
// scan for a tweet-date window, without moving the resume cursor) — #83.
let fetchMode: FetchMode = 'recent';
// True while a Scroll (worker-tab) batch job is running/paused — reported by
// batch-ui. We lock the selector whenever EITHER session is active so the two
// can't overlap and the selector can never disagree with the running session.
let manualJobActive = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

export function usesGraphqlEngine(): boolean {
  return batchEngine !== 'manual';
}
export function isGraphqlRunActive(): boolean {
  return graphqlRunActive;
}

// batch-ui listens for engine changes and completed GraphQL runs to re-evaluate
// the export button. Keep the event name compatible with existing listeners.
function notifyChanged(): void {
  window.dispatchEvent(new Event('xclipper-fast-changed'));
}

// Reconciles the batch view with the engine, fetch mode, and run state.
// The retained `fast-on` CSS hook follows the active acquisition path:
// Auto Full/Auto Fast use counts and Stop; Scroll uses a progress bar and pause/resume.
function applyBatchView(): void {
  const graphqlLayout = inBatchMode && (graphqlRunActive || (usesGraphqlEngine() && !manualJobActive));
  viewMain?.classList.toggle('fast-on', graphqlLayout);
  // Neither engine nor fetch mode can change mid-run (the sessions must never
  // overlap), so while either session runs both selectors fold into one line.
  const running = manualJobActive || graphqlRunActive;
  batchEngineField?.classList.toggle('hidden', !inBatchMode || running);
  batchRunSummary.classList.toggle('hidden', !inBatchMode || !running);
  batchRunSummary.textContent = [
    t(ENGINE_LABEL[batchEngine].key, ENGINE_LABEL[batchEngine].text),
    ...(usesGraphqlEngine() ? [t(FETCH_MODE_LABEL[fetchMode].key, FETCH_MODE_LABEL[fetchMode].text)] : []),
  ].join(' · ');
  // The fetch-mode segment + step lights are Auto Full/Auto Fast-only — show when armed.
  // The date inputs belong to Date-range fetch mode only.
  const showExtras = usesGraphqlEngine() && inBatchMode;
  fetchModeSelector?.classList.toggle('hidden', !showExtras || running);
  fetchDateRange?.classList.toggle('hidden', !(showExtras && fetchMode === 'dateRange'));
  graphqlSteps?.classList.toggle('hidden', !showExtras);
  updateFloodHint();
}

// Auto Full/Auto Fast save every loaded post as its own file — thousands of downloads
// unless the user picked Combined output or the zip toggle (a disabled zip
// toggle counts as off: local images override it). Shown below the engine and
// fetch-mode box; hidden mid-run,
// when it's too late to act on. Re-evaluated with the batch view here and on
// output/zip/format changes in settings-form. Its button applies the fix in
// place: Zip when available, otherwise Combined (local media blocks Zip).
export function updateFloodHint(): void {
  const zipOn = chkZip.checked && !chkZip.disabled;
  const running = manualJobActive || graphqlRunActive;
  const show = inBatchMode && !running && batchEngine !== 'manual' && !outCombined.checked && !zipOn;
  floodHint?.classList.toggle('hidden', !show);
  floodFix.textContent = chkZip.disabled
    ? t('flood_fix_combined', 'Use Combined')
    : t('flood_fix_zip', 'Turn on Zip');
}

// Apply + persist the chosen engine (no permission handling — see selectEngine).
function setBatchEngine(engine: BatchEngine): void {
  batchEngine = engine;
  engineManual?.classList.toggle('active', engine === 'manual');
  engineAuto?.classList.toggle('active', engine === 'auto');
  engineSuper?.classList.toggle('active', engine === 'super');
  if (batchEngineCaption) batchEngineCaption.textContent = t(ENGINE_CAPTION[engine].key, ENGINE_CAPTION[engine].text);
  // The feed rate-limit / re-run note applies to Auto Full/Auto Fast; Scroll acquires
  // posts through the DOM rather than replaying the source feed.
  batchEngineInfo?.classList.toggle('hidden', engine === 'manual');
  chrome.storage.local.set({ [BATCH_ENGINE_KEY]: engine });
  applyBatchView();
  notifyChanged();
}

// A user click on an engine segment. Scroll needs nothing; Auto Full/Auto Fast need the opt-in webRequest permission.
// request() must run synchronously in the click: Firefox rejects it from any
// async callback (e.g. after contains()). An already-granted request resolves
// true without a prompt, and a denial falls back to Scroll.
function selectEngine(engine: BatchEngine): void {
  if (manualJobActive || graphqlRunActive) return;
  if (engine === 'manual') {
    setBatchEngine('manual');
    return;
  }
  chrome.permissions.request(ACCESS, (granted) => {
    void chrome.runtime.lastError; // swallow benign gesture/denial errors
    setBatchEngine(granted ? engine : 'manual');
  });
}

function setFetchMode(fetch: FetchMode): void {
  fetchMode = fetch;
  fetchRecent?.classList.toggle('active', fetch === 'recent');
  fetchResume?.classList.toggle('active', fetch === 'resume');
  fetchDateRangeButton?.classList.toggle('active', fetch === 'dateRange');
  if (fetchModeCaption) fetchModeCaption.textContent = t(FETCH_MODE_CAPTION[fetch].key, FETCH_MODE_CAPTION[fetch].text);
  chrome.storage.local.set({ [FETCH_MODE_KEY]: fetch });
  applyBatchView(); // reveal/hide the date inputs for the new fetch
}

// The Page light only turns green once the source's own feed request is seen,
// and only that source's page fires it — reloading x.com/home never captures
// Bookmarks. So the label names the page to reload.
const PAGE_STEP: Record<GraphqlBatchSource, { key: string; text: string; hint: string }> = {
  bookmarks: { key: 'fast_step_page_bookmarks', text: 'Reload bookmarks', hint: 'Open x.com/i/history and reload it so its feed request is captured' },
  likes: { key: 'fast_step_page_likes', text: 'Reload likes', hint: 'Open x.com/i/history/likes and reload it so its feed request is captured' },
  profile: { key: 'fast_step_page_profile', text: 'Reload profile', hint: 'Open the profile you are exporting and reload it so its feed request is captured' },
};

// Step lights when idle: Page/Tweet show readiness (what to do before Export);
// Fetch/Expand are pending. During a run, render() drives them by phase.
export async function updateGraphqlSteps(source: GraphqlBatchSource): Promise<void> {
  if (graphqlRunActive) return; // a run owns the steps (see render)
  const page = PAGE_STEP[source];
  const pageLabel = graphqlStepPage?.querySelector('.fast-step-label');
  if (pageLabel) pageLabel.textContent = t(page.key, page.text);
  let r: GraphqlBatchReadyResponse | undefined;
  try {
    r = (await chrome.runtime.sendMessage({ action: 'FAST_BATCH_READY', source })) as
      | GraphqlBatchReadyResponse
      | undefined;
  } catch {
    return;
  }
  // A failed handler sends { success: false, error }, not a readiness answer.
  // Keep the steps as they are rather than tell the user to reload the page.
  if (typeof r?.feed !== 'boolean') return;
  setStep(graphqlStepPage, r?.feed ? 'ready' : 'missing', r?.feed ? '' : page.hint);
  setStep(graphqlStepTweet, r?.tweetDetail ? 'ready' : 'missing', r?.tweetDetail ? '' : 'Open any one tweet so threads & articles can be expanded');
  setStep(graphqlStepFetch, 'pending');
  setStep(graphqlStepExpand, 'pending');
}

function stepsFromProgress(p: GraphqlBatchProgress): void {
  setStep(graphqlStepPage, 'done');
  setStep(graphqlStepTweet, 'done');
  const phase = p.phase || '';
  setStep(graphqlStepFetch, phase.startsWith('Fetching') ? 'active' : 'done');
  setStep(graphqlStepExpand, phase.startsWith('Expanding') ? 'active' : phase.startsWith('Writing') ? 'done' : 'pending');
}

// Called by batch-ui as the Scroll job starts/stops.
export function setManualJobActive(active: boolean): void {
  manualJobActive = active;
  applyBatchView();
}

// Called by export-mode.ts when the Single/Batch tab flips: engine controls only
// make sense in Batch mode.
export function syncBatchEngineVisibility(single: boolean): void {
  inBatchMode = !single;
  applyBatchView();
}

export function initBatchEngineUi(): void {
  if (!batchEngineSelector) return;

  // Restore the saved engine, migrating the old two-flag GraphQL/Auto Fast state.
  // Auto Full/Auto Fast only stick if the webRequest permission is still granted (the
  // user could have revoked it in chrome://extensions).
  chrome.storage.local.get([BATCH_ENGINE_KEY, LEGACY_FAST_MODE_KEY, LEGACY_SUPER_MODE_KEY], (res) => {
    let engine: BatchEngine = 'manual';
    const saved = res[BATCH_ENGINE_KEY];
    if (saved === 'manual' || saved === 'auto' || saved === 'super') engine = saved;
    else if (res[LEGACY_FAST_MODE_KEY] === true) engine = res[LEGACY_SUPER_MODE_KEY] === true ? 'super' : 'auto';
    if (engine === 'manual') {
      setBatchEngine('manual');
      return;
    }
    chrome.permissions.contains(ACCESS, (granted) => setBatchEngine(granted ? engine : 'manual'));
  });

  // Engine segments. selectEngine handles Auto Full/Auto Fast consent.
  engineManual?.addEventListener('click', () => selectEngine('manual'));
  engineAuto?.addEventListener('click', () => selectEngine('auto'));
  engineSuper?.addEventListener('click', () => selectEngine('super'));

  // Captions explain a choice as it's made: a click on a segment group reveals
  // its caption, and the next click anywhere else hides it. Hover tooltips
  // carry the same text for anyone who hasn't clicked yet.
  const tip = (b: HTMLElement | null, c: { key: string; text: string }): void => {
    if (b) b.dataset.tooltip = t(c.key, c.text);
  };
  tip(engineManual, ENGINE_CAPTION.manual);
  tip(engineAuto, ENGINE_CAPTION.auto);
  tip(engineSuper, ENGINE_CAPTION.super);
  tip(fetchRecent, FETCH_MODE_CAPTION.recent);
  tip(fetchResume, FETCH_MODE_CAPTION.resume);
  tip(fetchDateRangeButton, FETCH_MODE_CAPTION.dateRange);
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    batchEngineCaption?.classList.toggle('hidden', !target.closest('.batch-mode'));
    fetchModeCaption?.classList.toggle('hidden', !target.closest('.fast-seg'));
  });

  // Date-range filter: restore, persist on change, and clear.
  chrome.storage.local.get([FROM_DATE_KEY, TO_DATE_KEY], (res) => {
    if (fetchDateFrom && typeof res[FROM_DATE_KEY] === 'string') fetchDateFrom.value = res[FROM_DATE_KEY];
    if (fetchDateTo && typeof res[TO_DATE_KEY] === 'string') fetchDateTo.value = res[TO_DATE_KEY];
  });
  fetchDateFrom?.addEventListener('change', () =>
    chrome.storage.local.set({ [FROM_DATE_KEY]: fetchDateFrom.value })
  );
  fetchDateTo?.addEventListener('change', () =>
    chrome.storage.local.set({ [TO_DATE_KEY]: fetchDateTo.value })
  );
  fetchDateClear?.addEventListener('click', () => {
    if (fetchDateFrom) fetchDateFrom.value = '';
    if (fetchDateTo) fetchDateTo.value = '';
    chrome.storage.local.set({ [FROM_DATE_KEY]: '', [TO_DATE_KEY]: '' });
  });

  // Recent | Resume | Date range fetch mode: restore, then toggle on click.
  chrome.storage.local.get(FETCH_MODE_KEY, (res) => {
    const saved = res[FETCH_MODE_KEY];
    setFetchMode(saved === 'resume' || saved === 'dateRange' ? saved : 'recent');
  });
  // The change event runs settings-form's own handler: persist, re-sync the
  // batch toggles, and re-evaluate (and so hide) this hint.
  floodFix.addEventListener('click', () => {
    const fix = chkZip.disabled ? outCombined : chkZip;
    fix.checked = true;
    fix.dispatchEvent(new Event('change'));
  });

  fetchRecent?.addEventListener('click', () => setFetchMode('recent'));
  fetchResume?.addEventListener('click', () => setFetchMode('resume'));
  fetchDateRangeButton?.addEventListener('click', () => setFetchMode('dateRange'));
}

// ─── GraphQL export run + progress polling ──────────────────────────────

export async function startGraphqlExport(
  source: GraphqlBatchSource,
  handle?: string
): Promise<void> {
  btnBatch.disabled = true;
  // The date window applies only in Date-range mode; swap if entered backwards.
  const dateMode = fetchMode === 'dateRange';
  let fromDate = dateMode ? fetchDateFrom?.value || undefined : undefined;
  let toDate = dateMode ? fetchDateTo?.value || undefined : undefined;
  if (fromDate && toDate && fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  // Auto Full expands threads + articles (correctness over raw speed); Auto Fast trades
  // thread expansion for a much larger per-run item budget (#85).
  const resp = (await chrome.runtime.sendMessage({
    action: 'FAST_BATCH_START',
    source,
    ...(handle ? { handle } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    expandThreads: batchEngine !== 'super',
    paginate: fetchMode,
  })) as GraphqlBatchStartResponse | undefined;
  if (!resp?.success) {
    showProgress(resp?.error || 'Could not start Auto Full/Auto Fast export.');
    return;
  }
  graphqlRunActive = true;
  applyBatchView();
  startPolling();
}

export async function cancelGraphqlRun(): Promise<void> {
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
  pollTimer = setInterval(() => void poll(), GRAPHQL_POLL_MS);
}

async function poll(): Promise<void> {
  let progress: GraphqlBatchProgress | undefined;
  try {
    const resp = (await chrome.runtime.sendMessage({
      action: 'FAST_BATCH_STATUS',
    })) as GraphqlBatchStatusResponse | undefined;
    progress = resp?.progress;
  } catch {
    return;
  }
  if (!progress) return;
  render(progress);
  if (progress.status !== 'running') {
    stopPolling();
    graphqlRunActive = false;
    applyBatchView(); // unfold the selectors now the run is done
    notifyChanged(); // batch-ui re-enables the export button
  }
}

// Whose/which GraphQL export — shown so progress stays meaningful after navigating.
function graphqlRunSourceLabel(p: GraphqlBatchProgress): string {
  if (p.source === 'profile' && p.handle) return `@${p.handle}`;
  if (p.source === 'bookmarks') return 'Bookmarks';
  if (p.source === 'likes') return 'Likes';
  return '';
}

function render(p: GraphqlBatchProgress): void {
  batchProgress.classList.remove('hidden');
  const running = p.status === 'running';
  // On an error (e.g. preconditions not met) show only the message — no bar,
  // which would otherwise look like a finished run.
  batchProgressRow?.classList.toggle('hidden', p.status === 'error');
  batchControls?.classList.toggle('hidden', !running);
  btnBatchCancel.classList.toggle('hidden', !running);
  btnBatchPause.classList.add('hidden'); // Auto Full/Auto Fast have no pause

  // No determinate bar for Auto Full/Auto Fast (hidden via #view-main.fast-on .batch-bar):
  // collection is open-ended and Auto Fast streams writes in parallel, so a
  // fraction would be fake. The count text + step lights carry progress instead.
  if (running) stepsFromProgress(p);

  const who = graphqlRunSourceLabel(p);
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
    batchProgressText.textContent = p.error || 'Auto Full/Auto Fast export failed';
  }
}

// On popup (re)open, resume showing a GraphQL run that's still going in the
// background — the popup is a fresh page, so its state was lost. Returns true if
// a run is in progress (caller forces Batch mode so the bar is visible).
export async function resumeGraphqlRunIfActive(): Promise<boolean> {
  let p: GraphqlBatchProgress | undefined;
  try {
    const resp = (await chrome.runtime.sendMessage({
      action: 'FAST_BATCH_STATUS',
    })) as GraphqlBatchStatusResponse | undefined;
    p = resp?.progress;
  } catch {
    return false;
  }
  if (p?.status !== 'running') return false;
  graphqlRunActive = true;
  applyBatchView();
  startPolling();
  return true;
}
