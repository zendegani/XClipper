// Fast Batch (ADR 0003) — live acquisition half, Phase A (console-triggerable,
// no UI yet, mirroring how ADR 0002 batch shipped first).
//
// We never ask for a password or a paid API key. With the opt-in `webRequest`
// permission granted, we observe the auth headers the browser ALREADY sends on
// your own x.com GraphQL requests, then replay the timeline endpoint ourselves —
// paginating by cursor (timeline.ts), mapping each tweet to the AST (jsonToAst),
// then writing through the SHARED batch sinks (batch-sink.ts) with the user's
// batch settings — so Fast Batch produces the same files as Standard batch, just
// far faster. Only acquisition differs.
//
// This module is impure (webRequest, fetch, permissions) and therefore not
// unit-tested — its pure dependencies (parse/paginate/map/sinks) are. Verify it
// live:
//   1) chrome://extensions → XClipper → service worker (Inspect)
//   2) await xclipperFastBatch()      // grants permission, then EXPORTS bookmarks
// If it says no request was captured, open https://x.com/i/bookmarks, scroll
// once, and re-run.

import type { Document } from '../ast/types';
import { jsonToAst } from '../graphql/json-to-ast';
import { tweetDetailToDocument } from '../graphql/tweet-detail';
import { getVariables, paginateTimeline, setVariablesParam } from '../graphql/timeline';
import { loadSettings } from '../shared/settings';
import { postProcess, resolveDownloadImages } from '../shared/post-process';
import { recordExport } from '../shared/review-prompt';
import {
  docToExtracted,
  writeCombined,
  writeJsonManifest,
  writePerItem,
  type StoredItem,
} from './batch-sink';
import {
  BATCH_MAX_ITEMS,
  EXPORTED_LEDGER_KEY,
  appendToLedger,
  batchFolderName,
  uniqueFilename,
} from './batch-state';

const GRAPHQL_FILTER = '*://x.com/i/api/graphql/*';
const FAST_BATCH_ORIGINS = ['*://x.com/*'];
const log = (...args: unknown[]): void => console.log('[xclipper fast-batch]', ...args);

interface XAuth {
  authorization: string;
  csrf: string;
}

// Last seen auth headers + the most recent timeline request URLs (each carries
// the rotating query-id + `features`, so replaying the observed request is
// robust to X changing them). Memory-only in Phase A; production will persist.
let auth: XAuth | null = null;
const templates: Record<string, string> = {};
let listening = false;

function captureHeaders(
  details: chrome.webRequest.OnBeforeSendHeadersDetails
): chrome.webRequest.BlockingResponse | undefined {
  const headers = details.requestHeaders ?? [];
  const get = (name: string): string | undefined =>
    headers.find((h) => h.name.toLowerCase() === name)?.value;
  const authorization = get('authorization');
  const csrf = get('x-csrf-token');
  if (authorization && csrf) auth = { authorization, csrf };

  const op = details.url.match(/\/graphql\/[^/]+\/(Bookmarks|Likes|UserTweets|TweetDetail)\b/)?.[1];
  if (op) templates[op] = details.url;
  return undefined; // observe-only; never block/modify
}

function startCapturing(): void {
  if (listening) return;
  // extraHeaders so the auth/csrf headers are reliably readable in MV3.
  chrome.webRequest.onBeforeSendHeaders.addListener(
    captureHeaders,
    { urls: [GRAPHQL_FILTER], types: ['xmlhttprequest'] },
    ['requestHeaders', 'extraHeaders']
  );
  listening = true;
  log('capturing X GraphQL auth headers');
}

async function hasAccess(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['webRequest'], origins: FAST_BATCH_ORIGINS });
}

// Request the opt-in permission (the consent UI will call this). Resolves true
// once granted; registers the capture listener on success.
export async function requestFastBatchAccess(): Promise<boolean> {
  const granted =
    (await hasAccess()) ||
    (await chrome.permissions.request({ permissions: ['webRequest'], origins: FAST_BATCH_ORIGINS }));
  if (granted) startCapturing();
  return granted;
}

// Replay a captured GraphQL request with the observed session auth. Cookies ride
// along via credentials:'include' + the x.com host permission; the csrf header
// must match the ct0 cookie, which is why we reuse the captured one.
async function authedFetchJson(url: string): Promise<unknown> {
  if (!auth) {
    throw new Error('No X auth captured yet — open x.com (e.g. /i/bookmarks) once, then retry');
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: auth.authorization,
      'x-csrf-token': auth.csrf,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'content-type': 'application/json',
    },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`X GraphQL responded ${res.status}`);
  return res.json();
}

// Per-item TweetDetail fetch — the bookmarks timeline carries only a tweet's
// root, so an Article's full body and a self-thread's continuation tweets both
// come from here (tweetDetailToDocument maps both). Built from the captured
// TweetDetail request so the query-id + `features` stay current; we only swap in
// the target id (`focalTweetId` is X's well-known TweetDetail variable). Returns
// null when no TweetDetail request has been observed yet.
async function fetchTweetDetailDoc(id: string, sourceUrl: string): Promise<Document | null> {
  const template = templates.TweetDetail;
  if (!template) return null;
  const vars = JSON.parse(getVariables(template)) as Record<string, unknown>;
  vars.focalTweetId = id;
  delete vars.cursor;
  const url = setVariablesParam(template, JSON.stringify(vars));
  return tweetDetailToDocument(await authedFetchJson(url), sourceUrl);
}

// Run `fn` over `items` with at most `limit` in flight (TweetDetail is one
// request per item; this keeps us well under X's GraphQL rate limits).
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function loadLedger(): Promise<string[]> {
  const r = await chrome.storage.local.get(EXPORTED_LEDGER_KEY);
  const raw = r[EXPORTED_LEDGER_KEY];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export interface FastBatchResult {
  exported: number;
  skipped: number;
  folder: string;
}

export interface FastBatchOptions {
  maxItems?: number;
  // Fetch TweetDetail for non-article tweets to expand self-threads (Articles
  // are always expanded — their body needs the fetch). On by default for
  // completeness; pass false for the fastest root-only run.
  expandThreads?: boolean;
}

// At most this many TweetDetail fetches in flight during expansion.
const TWEET_DETAIL_CONCURRENCY = 6;

// Phase-A trigger (no UI yet, like ADR 0002 batch): fetch the bookmarks
// timeline via GraphQL, map each tweet to the AST, expand Articles/threads via
// per-item TweetDetail, then postProcess + write through the SHARED sinks
// (per-item files / combined / data.json) using the user's batch settings.
// Honors the dedup ledger and the hard item cap. Console:
//   await xclipperFastBatch()                       // full (threads + articles)
//   await xclipperFastBatch({ expandThreads: false }) // fastest, root-only
async function runFastBatchExport(opts: FastBatchOptions = {}): Promise<FastBatchResult | null> {
  const maxItems = opts.maxItems ?? BATCH_MAX_ITEMS;
  const expandThreads = opts.expandThreads ?? true;
  if (!(await requestFastBatchAccess())) {
    log('permission denied — Fast Batch needs the optional webRequest access');
    return null;
  }
  const template = templates.Bookmarks;
  if (!template) {
    log('no Bookmarks request seen yet — open https://x.com/i/bookmarks, scroll once, then re-run');
    return null;
  }

  const settings = await loadSettings();
  const format = settings.batchFormat ?? 'md';
  // CSV is metadata-only — always one combined file (mirrors Standard batch).
  const output = format === 'csv' ? 'combined' : settings.batchOutput ?? 'separate';
  const frontmatterFields = settings.obsidianFriendly
    ? settings.frontmatterFieldsObsidian
    : settings.frontmatterFields;

  const now = new Date();
  const prefix = settings.downloadFolder.trim();
  const folder = (prefix ? `${prefix}/` : '') + batchFolderName(now);

  const ledger = new Set(await loadLedger());
  let ledgerArr = [...ledger];
  let skipped = 0;

  // Start from the top of the feed — drop any mid-scroll cursor the captured
  // request happened to carry.
  const vars = JSON.parse(getVariables(template)) as Record<string, unknown>;
  delete vars.cursor;
  const initialUrl = setVariablesParam(template, JSON.stringify(vars));

  // 1) Collect: paginate the bookmarks feed, mapping each root tweet, skipping
  //    anything already exported. (Cheap — pure mapping, no per-item fetch yet.)
  const selected: { doc: Document }[] = [];
  try {
    for await (const tweets of paginateTimeline(initialUrl, authedFetchJson, { maxPages: 25 })) {
      for (const raw of tweets) {
        if (selected.length >= maxItems) break;
        const doc = jsonToAst(raw);
        const id = doc.metadata.tweetId;
        if (id && ledger.has(id)) {
          skipped++;
          continue;
        }
        selected.push({ doc });
      }
      log(`fetched ${selected.length}${skipped ? ` (skipped ${skipped} already-exported)` : ''}`);
      if (selected.length >= maxItems) break;
    }
  } catch (err) {
    // Partial export is honest — we still write whatever we collected.
    log('fetch stopped early:', err);
  }

  // 2) Expand: Articles always (full body), other tweets when expandThreads.
  //    One concurrency-limited TweetDetail fetch per item; failures keep the
  //    root tweet / preview stub.
  const toExpand = selected.filter((s) => s.doc.metadata.type === 'article' || expandThreads);
  if (toExpand.length > 0 && !templates.TweetDetail) {
    log('cannot expand threads/articles: no TweetDetail request seen yet — open any tweet once, then re-run');
  } else if (toExpand.length > 0) {
    let expanded = 0;
    let failed = 0;
    await mapLimit(toExpand, TWEET_DETAIL_CONCURRENCY, async (s) => {
      try {
        const full = await fetchTweetDetailDoc(s.doc.metadata.tweetId, s.doc.metadata.sourceUrl);
        if (full) {
          s.doc = full;
          expanded++;
        }
      } catch {
        failed++; // keep the root tweet / article stub
      }
    });
    log(`expanded ${expanded}/${toExpand.length} via TweetDetail${failed ? ` (${failed} failed, kept root)` : ''}`);
  }

  // 3) Write: postProcess + the shared sinks, in feed order.
  const usedFilenames: string[] = [];
  const items: StoredItem[] = [];
  for (const { doc } of selected) {
    const result = postProcess(docToExtracted(doc), {
      includeMetadata: settings.includeMetadata,
      downloadImages: resolveDownloadImages('download', settings.downloadImages),
      inlineStats: settings.inlineStats,
      obsidianFriendly: settings.obsidianFriendly,
      filenameTemplate: settings.filenameTemplate.trim(),
      frontmatterFields,
    });
    const filename = uniqueFilename(usedFilenames, result.filename);
    usedFilenames.push(filename.toLowerCase());
    if (output !== 'combined') {
      writePerItem(folder, format, filename, result.markdown, result.images, doc, settings);
    }
    items.push({ url: doc.metadata.sourceUrl, filename, doc });
    const id = doc.metadata.tweetId;
    if (id) ledgerArr = appendToLedger(ledgerArr, id);
  }

  if (items.length > 0) {
    writeJsonManifest(
      folder,
      { jobId: `fast-${now.getTime()}`, status: 'done', completed: items.length, failures: [] },
      items
    );
    if (output === 'both' || output === 'combined') {
      writeCombined(folder, format, items.map((i) => i.doc), settings);
    }
    await chrome.storage.local.set({ [EXPORTED_LEDGER_KEY]: ledgerArr });
    void recordExport();
  }
  log(`done — exported ${items.length} → ${folder}/ (${skipped} skipped; ${format}/${output})`);
  return { exported: items.length, skipped, folder };
}


export function initFastBatch(): void {
  // Re-arm capture across service-worker restarts if access was already granted.
  void hasAccess().then((ok) => {
    if (ok) startCapturing();
  });
  chrome.permissions.onAdded.addListener((p) => {
    if (p.permissions?.includes('webRequest')) startCapturing();
  });
  // Phase-A trigger (see header).
  (globalThis as Record<string, unknown>).xclipperFastBatch = runFastBatchExport;
}
