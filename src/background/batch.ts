// Batch export orchestrator (ADR 0002, Phase A): owns the job queue, the
// hidden worker tab, throttle/timeout policy, and the folder sink. State
// transitions are pure (batch-state.ts); the job is persisted to
// chrome.storage.session after every step so an MV3 service-worker restart
// resumes the batch instead of orphaning it (ADR 0002 #4).
//
// Phase A has no UI. Temporary trigger from the service-worker DevTools
// console:
//   xclipperStartBatch(['https://x.com/user/status/123…', …])
// or send { action: 'BATCH_START', urls } from any extension page. Cancel
// with { action: 'BATCH_CONTROL', control: 'cancel' }.

import type {
  BatchItemResultMessage,
  BatchStartResponse,
  BatchStatusResponse,
} from '../types/messages';
import { loadSettings, type BatchFormat, type BatchOutput } from '../shared/settings';
import { recordExport } from '../shared/review-prompt';
import {
  downloadZipArchive,
  writeCombined,
  writeJsonManifest,
  writePerItem,
  zipEntryFromStored,
  type StoredItem,
} from './batch-sink';
import {
  isExtensionPageSender,
  isTrustedXContentSender,
} from './security';
import {
  type BatchJob,
  EXPORTED_LEDGER_KEY,
  appendToLedger,
  appendUrls,
  cancelJob,
  createJob,
  currentUrl,
  pauseJob,
  recordResult,
  resumeJob,
  statusIdOf,
} from './batch-state';

const JOB_KEY = 'xclipper_batch_job';
// Per-item AST payloads for the JSON sink, keyed by item index. Stored
// individually so each result is one small write, then assembled into a
// single data.json at finalize (ADR 0002 #11, open question resolved:
// per-job single file).
const DOC_KEY_PREFIX = 'xclipper_batch_doc_';
const WATCHDOG_ALARM = 'xclipper-batch-watchdog';
// Budget per item: navigation + waitForArticle (15 s) + the bounded thread
// scroll-walk in loadThreadIntoDom (worst case ~40 s) + extraction.
const ITEM_TIMEOUT_MS = 90_000;
const BATCH_MARKER = '#xclipper=batch';

// Politeness gap between permalink loads (ADR 0002 #7) — enough jitter to not
// look like a metronome, but far below the original 2–4 s, which dominated
// wall-clock on single-tweet batches. Interstitial detection + the
// consecutive-failure auto-pause below are what make a tight gap safe: if X
// starts throttling, the job pauses instead of hammering through.
function throttleMs(): number {
  return 600 + Math.random() * 600;
}

// Pause the whole job after this many failures in a row. Individual bad tweets
// (deleted, restricted) are rare enough that a run this long almost always
// means X is rate-limiting or serving walls the in-page check didn't catch.
const FAILURE_PAUSE_THRESHOLD = 5;

const log = (...args: unknown[]): void => console.log('[xclipper batch]', ...args);

async function loadJob(): Promise<BatchJob | null> {
  const result = await chrome.storage.session.get(JOB_KEY);
  return (result[JOB_KEY] as BatchJob | undefined) ?? null;
}

async function saveJob(job: BatchJob): Promise<void> {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

async function loadLedger(): Promise<string[]> {
  const result = await chrome.storage.local.get(EXPORTED_LEDGER_KEY);
  const raw = result[EXPORTED_LEDGER_KEY];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

async function recordExported(url: string): Promise<void> {
  const id = statusIdOf(url);
  if (!id) return;
  const ledger = await loadLedger();
  await chrome.storage.local.set({ [EXPORTED_LEDGER_KEY]: appendToLedger(ledger, id) });
}

const JOB_ORIGINS = ['bookmarks', 'profile', 'selection', 'likes', 'timeline'] as const;

function coerceOrigin(raw: unknown): BatchJob['origin'] {
  return JOB_ORIGINS.includes(raw as (typeof JOB_ORIGINS)[number])
    ? (raw as BatchJob['origin'])
    : undefined;
}

const JOB_FORMATS = ['md', 'txt', 'html', 'json', 'csv'] as const;
const JOB_OUTPUTS = ['separate', 'both', 'combined'] as const;

function coerceFormat(raw: unknown): BatchFormat {
  return JOB_FORMATS.includes(raw as BatchFormat) ? (raw as BatchFormat) : 'md';
}

function coerceOutput(raw: unknown): BatchOutput {
  return JOB_OUTPUTS.includes(raw as BatchOutput) ? (raw as BatchOutput) : 'separate';
}

// CSV is metadata-only — a per-item CSV is a one-row file, so the whole job is
// always one combined CSV regardless of the stored grouping.
function effectiveOutput(job: BatchJob): BatchOutput {
  if (job.format === 'csv') return 'combined';
  return job.output ?? 'separate';
}

// Format conversion + all sink writers now live in batch-sink.ts, shared with
// Fast Batch — only acquisition differs between the two batch paths.

export async function startBatch(
  rawUrls: unknown,
  origin?: BatchJob['origin'],
  handle?: string,
  format: BatchFormat = 'md',
  output: BatchOutput = 'separate'
): Promise<BatchStartResponse> {
  const existing = await loadJob();
  if (existing && (existing.status === 'running' || existing.status === 'paused')) {
    return { success: false, error: 'A batch job is already running' };
  }
  if (!Array.isArray(rawUrls)) {
    return { success: false, error: 'urls must be an array of status permalinks' };
  }

  const urls = rawUrls.filter((u): u is string => typeof u === 'string');
  let job = createJob(urls, new Date());
  if (job.urls.length === 0) {
    return { success: false, error: 'No valid x.com status URLs given' };
  }
  // Skip anything a previous job already exported, so re-running on a longer
  // scroll of the same list only picks up the new items.
  const ledger = new Set(await loadLedger());
  const fresh = job.urls.filter((u) => {
    const id = statusIdOf(u);
    return !id || !ledger.has(id);
  });
  if (fresh.length === 0) {
    return { success: false, error: 'Everything loaded was already exported — use Reset to export again' };
  }
  if (fresh.length < job.urls.length) {
    log(`${job.urls.length - fresh.length} already-exported item(s) skipped`);
  }
  job = {
    ...job,
    urls: fresh,
    format,
    output,
    ...(origin ? { origin } : {}),
    ...(origin === 'profile' && handle ? { handle } : {}),
  };
  // Snapshot the user's download subfolder once so the whole job lands in one
  // place even if the setting changes mid-run. Same for the zip choice — local
  // images override it off (image bytes can't be fetched into the archive).
  const settings = await loadSettings();
  const prefix = settings.downloadFolder.trim();
  if (prefix) job = { ...job, folder: `${prefix}/${job.folder}` };
  if (settings.batchZip && !(settings.downloadImages && format === 'md')) job = { ...job, zip: true };

  log(`job ${job.id}: ${job.urls.length} item(s) → ${job.folder}/`);
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  await dispatchCurrent(job);
  return { success: true, total: job.urls.length };
}

// Add newly-scrolled items to the live job's queue. The popup only offers
// this on the running job's own source, so a long batch can keep absorbing
// items the user loads instead of finishing short or being restarted.
export async function appendBatch(rawUrls: unknown): Promise<BatchStartResponse> {
  const job = await loadJob();
  if (!job || (job.status !== 'running' && job.status !== 'paused')) {
    return { success: false, error: 'No batch job is running' };
  }
  if (!Array.isArray(rawUrls)) {
    return { success: false, error: 'urls must be an array of status permalinks' };
  }
  const urls = rawUrls.filter((u): u is string => typeof u === 'string');
  const exportedIds = new Set(await loadLedger());
  const { job: next, added } = appendUrls(job, urls, exportedIds);
  if (added === 0) return { success: false, error: 'Nothing new to add' };
  await saveJob(next);
  log(`appended ${added} item(s) to job ${job.id}: ${next.urls.length} total`);
  // If the job had drained to its last item and was idling between dispatches,
  // nudge the loop so the freshly-queued items get picked up promptly.
  if (next.status === 'running' && !next.awaitingResult) void tick();
  return { success: true, total: next.urls.length };
}

// Navigate the worker to the current item (creating it for the first one)
// and arm the per-item timeout.
//
// The worker is a small UNFOCUSED popup window, not a background tab: Chrome
// never paints hidden tabs, so requestAnimationFrame doesn't fire there and
// X's virtualized timeline neither mounts the rest of a thread nor hydrates
// lazy media — extractions came back with only the root tweet and no images.
// An unfocused-but-visible window keeps rendering without stealing focus.
// (A fully occluded window is treated as hidden again; items then fail by
// timeout and are recorded, not lost silently.)
async function dispatchCurrent(job: BatchJob): Promise<void> {
  const url = currentUrl(job);
  if (!url) {
    await finalize(job);
    return;
  }
  const target = url + BATCH_MARKER;
  let tabId = job.workerTabId;
  let windowId = job.workerWindowId;
  if (tabId !== undefined) {
    try {
      await chrome.tabs.update(tabId, { url: target });
    } catch {
      // Tab is gone. If that was a user-close, the onRemoved handler has
      // already cancelled the job — re-check before resurrecting the worker.
      const fresh = await loadJob();
      if (fresh?.status !== 'running') return;
      tabId = undefined;
    }
  }
  if (tabId === undefined) {
    // Width must stay above X's narrow-layout breakpoint: the mobile layout
    // drops the longform-header-*/list CSS classes that article extraction
    // keys on, so a 480px window silently degraded article exports.
    const win = await chrome.windows.create({
      url: target,
      focused: false,
      type: 'popup',
      width: 1100,
      height: 900,
    });
    tabId = win?.tabs?.[0]?.id;
    windowId = win?.id;
  }
  await saveJob({
    ...job,
    workerTabId: tabId,
    workerWindowId: windowId,
    awaitingResult: true,
    deadline: Date.now() + ITEM_TIMEOUT_MS,
    nextDispatchAt: undefined,
  });
}

async function handleItemResult(
  msg: BatchItemResultMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const job = await loadJob();
  if (!job || job.status !== 'running' || !job.awaitingResult) return;
  if (!isTrustedXContentSender(sender) || sender.tab?.id !== job.workerTabId) return;

  // Drop late/duplicate reports from a previous navigation of the worker tab
  // (e.g. an item that already timed out finally finishing).
  const expected = currentUrl(job);
  if (!expected || statusIdOf(msg.url || '') !== statusIdOf(expected)) return;

  // A login/rate-limit wall is a session-level stop, not a per-item failure:
  // pause the whole job (ADR 0002 #7) with the worker's reason and leave this
  // item un-advanced, so Resume retries it once the user has cleared the wall.
  // The worker window stays open (the user may need it to sign in).
  if (msg.interstitial) {
    log(`auto-paused — ${msg.interstitial}`);
    await saveJob({ ...pauseJob(job), pauseReason: msg.interstitial });
    return;
  }

  // Perf breakdown for tuning (deadline = dispatchedAt + ITEM_TIMEOUT_MS, so
  // total is wall-time since the worker was pointed at this item; nav is the
  // remainder after the worker's own wait/extract phases — page load + boot).
  if (msg.timings && job.deadline !== undefined) {
    const total = Date.now() - (job.deadline - ITEM_TIMEOUT_MS);
    const nav = total - msg.timings.waitMs - msg.timings.extractMs;
    log(
      `item ${total}ms (nav ~${nav}ms, wait ${msg.timings.waitMs}ms, ` +
        `extract ${msg.timings.extractMs}ms): ${expected}`
    );
  }

  const outcome =
    msg.success && typeof msg.markdown === 'string' && typeof msg.filename === 'string'
      ? { success: true as const, filename: msg.filename }
      : { success: false as const, error: msg.error || 'Extraction failed' };

  const { job: advanced, filename } = recordResult(job, outcome);
  if (outcome.success && filename) {
    // 'combined' writes nothing per item — the one file is built at finalize.
    // Zip mode also defers to finalize: entries are rebuilt there from the
    // stored docs, so nothing per-item hits the downloads shelf.
    // (msg.doc missing means there's nothing to rebuild from at finalize, so
    // such an item is written loose even in zip mode.)
    if (effectiveOutput(job) !== 'combined' && !(job.zip && msg.doc)) {
      await writePerItem(
        advanced.folder,
        job.format ?? 'md',
        filename,
        msg.markdown as string,
        msg.images,
        msg.doc,
        await loadSettings()
      );
    }
    await recordExported(expected);
    if (msg.doc) {
      try {
        await chrome.storage.session.set({
          [DOC_KEY_PREFIX + job.nextIndex]: { url: expected, filename, doc: msg.doc },
        });
      } catch (err) {
        // storage.session quota (~10 MB) — the .md files are already on disk,
        // so a huge batch just loses this item from data.json. In zip mode the
        // stored doc IS the file, so fall back to a loose per-item download
        // rather than silently dropping the post from the export.
        log(`doc not kept for data.json (${expected}):`, err);
        if (job.zip && effectiveOutput(job) !== 'combined') {
          await writePerItem(
            advanced.folder,
            job.format ?? 'md',
            filename,
            msg.markdown as string,
            msg.images,
            msg.doc,
            await loadSettings()
          );
        }
      }
    }
  } else if (!outcome.success) {
    log(`item failed: ${expected} — ${outcome.error}`);
  }
  await continueAfter(advanced);
}

// Persist, then either finish or move on after the politeness throttle. The
// watchdog alarm re-runs tick() if the service worker dies during the
// setTimeout, so the delay survives a worker restart (just stretched).
async function continueAfter(job: BatchJob): Promise<void> {
  if (job.status !== 'running') {
    await finalize(job);
    return;
  }
  // A run of failures past the threshold almost always means X is rate-limiting
  // or serving walls (ADR 0002 #7) — pause instead of grinding the rest of the
  // queue into the same wall. Resume clears the counter for a fresh attempt.
  if (job.consecutiveFailures >= FAILURE_PAUSE_THRESHOLD) {
    const reason = `${job.consecutiveFailures} items failed in a row — X may be rate-limiting`;
    log(`auto-paused — ${reason}`);
    await saveJob({ ...pauseJob(job), pauseReason: reason });
    return;
  }
  const wait = throttleMs();
  await saveJob({ ...job, nextDispatchAt: Date.now() + wait });
  setTimeout(() => void tick(), wait);
}

// Single re-entry point for the throttle setTimeout, the watchdog alarm, and
// service-worker startup. Always loads fresh state and decides from it, so
// overlapping invocations converge instead of double-dispatching.
async function tick(): Promise<void> {
  const job = await loadJob();
  if (!job || job.status !== 'running') return;

  // Worker tab disappeared while we weren't looking (e.g. closed while the
  // service worker was dead) — same as an onRemoved cancel.
  if (job.workerTabId !== undefined) {
    try {
      await chrome.tabs.get(job.workerTabId);
    } catch {
      log('worker tab gone — cancelling job');
      await finalize(cancelJob(job));
      return;
    }
  }

  if (job.awaitingResult) {
    if (job.deadline !== undefined && Date.now() > job.deadline) {
      log(`item timed out: ${currentUrl(job)}`);
      const { job: advanced } = recordResult(job, { success: false, error: 'Timed out' });
      await continueAfter(advanced);
    }
    return; // still within the item's time budget
  }

  if (job.nextDispatchAt === undefined || Date.now() >= job.nextDispatchAt) {
    await dispatchCurrent(job);
  }
}

async function takeStoredItems(job: BatchJob): Promise<StoredItem[]> {
  const keys = job.urls.map((_, i) => DOC_KEY_PREFIX + i);
  const stored = await chrome.storage.session.get(keys);
  await chrome.storage.session.remove(keys);
  return keys
    .map((k) => stored[k] as StoredItem | undefined)
    .filter((v): v is StoredItem => v !== undefined);
}

// The finished/cancelled job stays in storage for inspection until the next
// startBatch overwrites it.
async function finalize(job: BatchJob): Promise<void> {
  await saveJob(job);
  await chrome.alarms.clear(WATCHDOG_ALARM);
  try {
    const items = await takeStoredItems(job);
    if (items.length > 0) {
      await writeJsonManifest(
        job.folder,
        { jobId: job.id, status: job.status, completed: job.completed, failures: job.failures },
        items
      );
      const out = effectiveOutput(job);
      const settings = await loadSettings();
      if (out === 'both' || out === 'combined') {
        await writeCombined(job.folder, job.format ?? 'md', items.map((i) => i.doc), settings);
      }
      if (job.zip && out !== 'combined') {
        await downloadZipArchive(
          job.folder,
          items.map((i) => zipEntryFromStored(i, job.format ?? 'md', settings))
        );
      }
    }
  } catch (err) {
    log('data.json/combined write failed:', err);
  }
  log(
    `job ${job.id} ${job.status}: ${job.completed} exported, ` +
      `${job.failures.length} failed → ${job.folder}/`
  );
  for (const f of job.failures) log(`  failed: ${f.url} — ${f.error}`);
  // A whole batch counts as one export toward the review prompt (not per file).
  if (job.completed > 0) void recordExport();
  if (job.workerWindowId !== undefined) {
    try {
      await chrome.windows.remove(job.workerWindowId);
    } catch {
      // already closed
    }
  } else if (job.workerTabId !== undefined) {
    try {
      await chrome.tabs.remove(job.workerTabId);
    } catch {
      // already closed
    }
  }
}

export function initBatch(): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;
    if (msg.action === 'BATCH_START') {
      // Extension pages (popup), plus our own injector content script on
      // x.com — selection mode starts batches from the page (Phase C).
      if (
        !isExtensionPageSender(sender, chrome.runtime.id) &&
        !isTrustedXContentSender(sender)
      ) {
        sendResponse({ success: false, error: 'Untrusted sender' });
        return false;
      }
      const handle = typeof msg.handle === 'string' ? msg.handle : undefined;
      startBatch(
        msg.urls,
        coerceOrigin(msg.origin),
        handle,
        coerceFormat(msg.format),
        coerceOutput(msg.output)
      ).then(sendResponse);
      return true; // async sendResponse
    }
    if (msg.action === 'BATCH_APPEND') {
      if (
        !isExtensionPageSender(sender, chrome.runtime.id) &&
        !isTrustedXContentSender(sender)
      ) {
        sendResponse({ success: false, error: 'Untrusted sender' });
        return false;
      }
      appendBatch(msg.urls).then(sendResponse);
      return true; // async sendResponse
    }
    if (msg.action === 'BATCH_CONTROL') {
      if (!isExtensionPageSender(sender, chrome.runtime.id)) {
        sendResponse({ success: false, error: 'Untrusted sender' });
        return false;
      }
      void (async () => {
        const job = await loadJob();
        if (msg.control === 'cancel') {
          if (job && (job.status === 'running' || job.status === 'paused')) {
            await finalize(cancelJob(job));
          }
        } else if (msg.control === 'pause') {
          if (job?.status === 'running') {
            await saveJob(pauseJob(job));
            log('job paused');
          }
        } else if (msg.control === 'resume') {
          if (job?.status === 'paused') {
            const resumed = resumeJob(job);
            log('job resumed');
            // Re-dispatch the item that was in flight when paused.
            await dispatchCurrent(resumed);
          }
        }
        sendResponse({ success: true });
      })();
      return true; // async sendResponse
    }
    if (msg.action === 'BATCH_STATUS') {
      if (!isExtensionPageSender(sender, chrome.runtime.id)) {
        sendResponse({});
        return false;
      }
      void (async () => {
        const job = await loadJob();
        const resp: BatchStatusResponse = job
          ? {
              job: {
                id: job.id,
                status: job.status,
                ...(job.origin ? { origin: job.origin } : {}),
                ...(job.handle ? { handle: job.handle } : {}),
                total: job.urls.length,
                completed: job.completed,
                failed: job.failures.length,
                folder: job.folder,
                queuedIds: job.urls
                  .map((u) => statusIdOf(u))
                  .filter((id): id is string => id !== null),
                ...(job.pauseReason ? { pauseReason: job.pauseReason } : {}),
              },
            }
          : {};
        sendResponse(resp);
      })();
      return true; // async sendResponse
    }
    if (msg.action === 'BATCH_ITEM_RESULT') {
      void handleItemResult(msg as BatchItemResultMessage, sender);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const job = await loadJob();
      // The user closed the worker tab → cancel rather than resurrect it.
      // finalize() skips its own tabs.remove on the already-dead tab.
      if (
        job &&
        (job.status === 'running' || job.status === 'paused') &&
        job.workerTabId === tabId
      ) {
        log('worker tab closed — cancelling job');
        await finalize(cancelJob(job));
      }
    })();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHDOG_ALARM) void tick();
  });

  // Service worker restarted mid-job → pick up from the persisted state.
  void tick();

  // Phase A temporary trigger (see header comment).
  (globalThis as Record<string, unknown>).xclipperStartBatch = (urls: string[]) =>
    startBatch(urls).then((r) => {
      log('startBatch:', JSON.stringify(r));
      return r;
    });
}
