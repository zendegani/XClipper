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
import { loadSettings } from '../shared/settings';
import {
  isAllowedImageUrl,
  isExtensionPageSender,
  isTrustedXContentSender,
  sanitizeFilePath,
} from './security';
import {
  type BatchJob,
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

// Behave like a patient user in their own session: 2–4 s between permalink
// loads (ADR 0002 #7).
function throttleMs(): number {
  return 2000 + Math.random() * 2000;
}

const log = (...args: unknown[]): void => console.log('[xclipper batch]', ...args);

async function loadJob(): Promise<BatchJob | null> {
  const result = await chrome.storage.session.get(JOB_KEY);
  return (result[JOB_KEY] as BatchJob | undefined) ?? null;
}

async function saveJob(job: BatchJob): Promise<void> {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

export async function startBatch(rawUrls: unknown): Promise<BatchStartResponse> {
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
  // Snapshot the user's download subfolder once so the whole job lands in one
  // place even if the setting changes mid-run.
  const settings = await loadSettings();
  const prefix = settings.downloadFolder.trim();
  if (prefix) job = { ...job, folder: `${prefix}/${job.folder}` };

  log(`job ${job.id}: ${job.urls.length} item(s) → ${job.folder}/`);
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  await dispatchCurrent(job);
  return { success: true, total: job.urls.length };
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

  const outcome =
    msg.success && typeof msg.markdown === 'string' && typeof msg.filename === 'string'
      ? { success: true as const, filename: msg.filename }
      : { success: false as const, error: msg.error || 'Extraction failed' };

  const { job: advanced, filename } = recordResult(job, outcome);
  if (outcome.success && filename) {
    downloadItem(advanced.folder, filename, msg.markdown as string, msg.images);
    if (msg.doc) {
      try {
        await chrome.storage.session.set({
          [DOC_KEY_PREFIX + job.nextIndex]: { url: expected, filename, doc: msg.doc },
        });
      } catch (err) {
        // storage.session quota (~10 MB) — the .md files are already on disk,
        // so a huge batch just loses this item from data.json.
        log(`doc not kept for data.json (${expected}):`, err);
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

// JSON sink (ADR 0002 #11): one data.json per job with metadata, failures,
// and every successful item's AST. Written for cancelled jobs too — the
// matching .md files are already on disk, partial is honest.
async function writeJsonManifest(job: BatchJob): Promise<void> {
  const keys = job.urls.map((_, i) => DOC_KEY_PREFIX + i);
  const stored = await chrome.storage.session.get(keys);
  await chrome.storage.session.remove(keys);
  const items = keys.map((k) => stored[k]).filter((v) => v !== undefined);
  if (items.length === 0) return;
  const manifest = {
    generator: 'xclipper-batch',
    jobId: job.id,
    exportedAt: new Date().toISOString(),
    status: job.status,
    completed: job.completed,
    failures: job.failures,
    items,
  };
  chrome.downloads.download({
    url:
      'data:application/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(manifest, null, 2)),
    filename: sanitizeFilePath(`${job.folder}/data.json`),
    saveAs: false,
  });
}

// The finished/cancelled job stays in storage for inspection until the next
// startBatch overwrites it.
async function finalize(job: BatchJob): Promise<void> {
  await saveJob(job);
  await chrome.alarms.clear(WATCHDOG_ALARM);
  try {
    await writeJsonManifest(job);
  } catch (err) {
    log('data.json write failed:', err);
  }
  log(
    `job ${job.id} ${job.status}: ${job.completed} exported, ` +
      `${job.failures.length} failed → ${job.folder}/`
  );
  for (const f of job.failures) log(`  failed: ${f.url} — ${f.error}`);
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

// Folder sink (ADR 0002 #11): every file of the job lands under its downloads
// subfolder. Markdown filenames are collision-deduped by the job state; image
// paths already embed the item's own media dir, and Chrome uniquifies any
// residual conflict.
function downloadItem(
  folder: string,
  filename: string,
  markdown: string,
  images?: { url: string; filename: string }[]
): void {
  for (const img of images ?? []) {
    if (!img || typeof img.url !== 'string' || !isAllowedImageUrl(img.url)) continue;
    chrome.downloads.download({
      url: img.url,
      filename: sanitizeFilePath(`${folder}/${img.filename}`),
      saveAs: false,
    });
  }
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);
  chrome.downloads.download({
    url: dataUrl,
    filename: sanitizeFilePath(`${folder}/${filename}`),
    saveAs: false,
  });
}

export function initBatch(): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;
    if (msg.action === 'BATCH_START') {
      if (!isExtensionPageSender(sender, chrome.runtime.id)) {
        sendResponse({ success: false, error: 'Untrusted sender' });
        return false;
      }
      startBatch(msg.urls).then(sendResponse);
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
                total: job.urls.length,
                completed: job.completed,
                failed: job.failures.length,
                folder: job.folder,
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
