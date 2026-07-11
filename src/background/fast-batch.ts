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
import type {
  FastBatchProgress,
  FastBatchReadyResponse,
  FastBatchStartResponse,
  FastBatchStatusResponse,
} from '../types/messages';
import { isExtensionPageSender } from './security';
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
  EXPORTED_LEDGER_KEY,
  INCOMPLETE_LEDGER_KEY,
  RESUME_CURSOR_KEY,
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
// robust to X changing them). Persisted to chrome.storage.session so they
// survive the MV3 service worker being torn down between runs (otherwise a
// re-run minutes later would wrongly ask the user to re-capture). Session
// storage is in-memory + cleared on browser close, appropriate for the auth.
const SESSION_AUTH_KEY = 'fastBatchAuth';
const SESSION_TEMPLATES_KEY = 'fastBatchTemplates';
let auth: XAuth | null = null;
const templates: Record<string, string> = {};
let listening = false;

// Polled progress for the popup (Fast Batch has no per-item worker tab, so it
// can't reuse the Standard batch job model). Cancel is cooperative — the run
// loops check the flag at phase boundaries.
let progress: FastBatchProgress = {
  status: 'idle',
  phase: '',
  done: 0,
  total: 0,
  exported: 0,
  skipped: 0,
};
let cancelRequested = false;
const setProgress = (p: Partial<FastBatchProgress>): void => {
  progress = { ...progress, ...p };
};

function captureHeaders(
  details: chrome.webRequest.OnBeforeSendHeadersDetails
): chrome.webRequest.BlockingResponse | undefined {
  const headers = details.requestHeaders ?? [];
  const get = (name: string): string | undefined =>
    headers.find((h) => h.name.toLowerCase() === name)?.value;
  const authorization = get('authorization');
  const csrf = get('x-csrf-token');
  if (authorization && csrf && (auth?.authorization !== authorization || auth?.csrf !== csrf)) {
    auth = { authorization, csrf };
    void chrome.storage.session.set({ [SESSION_AUTH_KEY]: auth });
  }

  const op = details.url.match(/\/graphql\/[^/]+\/(Bookmarks|Likes|UserTweets|TweetDetail)\b/)?.[1];
  if (op && templates[op] !== details.url) {
    templates[op] = details.url;
    void chrome.storage.session.set({ [SESSION_TEMPLATES_KEY]: { ...templates } });
  }
  return undefined; // observe-only; never block/modify
}

// Reload captured auth + request templates from session storage into memory
// (after a service-worker restart). Awaited before a run so the precondition
// check sees them, not just fired-and-forgotten at init.
async function restoreSession(): Promise<void> {
  const r = await chrome.storage.session.get([SESSION_AUTH_KEY, SESSION_TEMPLATES_KEY]);
  if (!auth && r[SESSION_AUTH_KEY]) auth = r[SESSION_AUTH_KEY] as XAuth;
  const saved = r[SESSION_TEMPLATES_KEY] as Record<string, string> | undefined;
  if (saved) for (const k of Object.keys(saved)) templates[k] ??= saved[k];
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
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`X GraphQL responded ${status}`);
  }
}

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
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

// X returns rate-limit / "Something went wrong" as a GraphQL errors envelope
// (HTTP 200) just as often as a 429 — both mean "back off".
class GraphqlError extends Error {
  constructor(messages: string[]) {
    super(`X GraphQL error: ${messages.join('; ')}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type ErrorKind = 'rate-limit' | 'transient' | 'permanent';

// 429 and GraphQL error envelopes mean the account is being throttled — stop
// spending the TweetDetail budget. 5xx / network blips are transient (retry). A
// 4xx (deleted/protected tweet) or a mapping miss is permanent (keep the root).
function classify(err: unknown): ErrorKind {
  if (err instanceof HttpError) return err.status === 429 ? 'rate-limit' : err.status >= 500 ? 'transient' : 'permanent';
  if (err instanceof GraphqlError) return 'rate-limit';
  if (err instanceof TypeError) return 'transient'; // fetch network failure
  return 'permanent';
}

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1200;

// Per-item TweetDetail fetch — the bookmarks timeline carries only a tweet's
// root, so an Article's full body and a self-thread's continuation tweets both
// come from here (tweetDetailToDocument maps both). Built from the captured
// TweetDetail request so the query-id + `features` stay current; we only swap in
// the target id (`focalTweetId` is X's well-known TweetDetail variable). Returns
// null when no TweetDetail request has been observed yet. Retries transient /
// rate-limit failures with backoff; throws the last error otherwise.
async function fetchTweetDetailDoc(id: string, sourceUrl?: string): Promise<Document | null> {
  const template = templates.TweetDetail;
  if (!template) return null;
  const vars = JSON.parse(getVariables(template)) as Record<string, unknown>;
  vars.focalTweetId = id;
  delete vars.cursor;
  const url = setVariablesParam(template, JSON.stringify(vars));

  for (let attempt = 0; ; attempt++) {
    try {
      const json = await authedFetchJson(url);
      const errs = (json as { errors?: { message?: string }[] }).errors;
      if (Array.isArray(errs) && errs.length) throw new GraphqlError(errs.map((e) => e.message ?? 'error'));
      return tweetDetailToDocument(json, sourceUrl);
    } catch (err) {
      if (classify(err) === 'permanent' || attempt >= MAX_RETRIES) throw err;
      await sleep(RETRY_BASE_MS * 2 ** attempt + Math.random() * 400);
    }
  }
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

// A retweet is a tweet by the profile owner (the retweeter) carrying the
// original under legacy.retweeted_status_result — so an author===owner check
// can't catch it. Detect it structurally instead.
function isRepost(raw: unknown): boolean {
  const t = (raw as { tweet?: unknown }).tweet ?? raw;
  return !!(t as { legacy?: { retweeted_status_result?: unknown } }).legacy?.retweeted_status_result;
}

async function loadLedger(): Promise<string[]> {
  const r = await chrome.storage.local.get(EXPORTED_LEDGER_KEY);
  const raw = r[EXPORTED_LEDGER_KEY];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

async function loadIncomplete(): Promise<string[]> {
  const r = await chrome.storage.local.get(INCOMPLETE_LEDGER_KEY);
  const raw = r[INCOMPLETE_LEDGER_KEY];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export interface FastBatchResult {
  exported: number;
  skipped: number;
  folder: string;
}

export type FastSource = 'bookmarks' | 'profile' | 'likes';

// Which captured GraphQL operation backs each source, + a label for progress.
const SOURCE_CONFIG: Record<FastSource, { op: string; label: string }> = {
  bookmarks: { op: 'Bookmarks', label: 'bookmarks' },
  profile: { op: 'UserTweets', label: 'posts' },
  likes: { op: 'Likes', label: 'likes' },
};

// Resume-mode frontier per source (issue #83): the cursor where the last Resume
// run stopped consuming, so the next continues from there.
type ResumeCursors = Partial<Record<FastSource, string>>;
async function loadResumeCursors(): Promise<ResumeCursors> {
  const r = await chrome.storage.local.get(RESUME_CURSOR_KEY);
  const raw = r[RESUME_CURSOR_KEY];
  return raw && typeof raw === 'object' ? (raw as ResumeCursors) : {};
}

export interface FastBatchOptions {
  source?: FastSource;
  // Profile owner's handle — reposts (author ≠ handle) are skipped, matching
  // Standard profile export.
  handle?: string;
  // YYYY-MM-DD bounds on the tweet date; out-of-range items are skipped before
  // expansion, so a tighter range avoids X's TweetDetail rate limit.
  fromDate?: string;
  toDate?: string;
  maxItems?: number;
  // Fetch TweetDetail for non-article tweets to expand self-threads (Articles
  // are always expanded — their body needs the fetch). On by default for
  // completeness; pass false for the fastest root-only run.
  expandThreads?: boolean;
  // Fetch mode (issue #83): 'recent' paginates from the top; 'resume' continues
  // from the saved per-source cursor (deep backfill); 'dateRange' deep-scans from
  // the top for posts within fromDate..toDate — dedups against history but does
  // NOT read or advance the resume cursor, so it never disturbs a Resume run.
  paginate?: 'recent' | 'resume' | 'dateRange';
}

// At most this many TweetDetail fetches in flight during expansion. Kept low on
// purpose: bursting TweetDetail (we saw ~6-wide bursts trip X's per-account
// quota at ~150 calls, soft-blocking the user's own browsing with "Something
// went wrong"). Gentle + stop-on-rate-limit protects the session.
const TWEET_DETAIL_CONCURRENCY = 3;

// Items collected per Fast Batch run. Deliberately matched to the ~150-call
// TweetDetail budget above (not the Standard batch's 200): if collection
// exceeds the expansion budget, every run leaves the overflow as un-expanded
// stubs, and since the next run completes that backlog FIRST, the leftover
// compounds upward each run. Sizing the run to the budget means a run expands
// everything it collects — no growing backlog.
const FAST_BATCH_MAX_ITEMS = 150;

// Feed pages a run will walk. Recent scans the top, so a small window is enough.
// The deep modes need a much larger ceiling: Resume pages PAST everything already
// exported to reach fresh items; Date range pages down to an old tweet-date
// window. Resume only pays that cost once (its saved frontier starts the next run
// deep); Date range pays it each run (it never saves a cursor).
const RECENT_MAX_PAGES = 25;
const RESUME_MAX_PAGES = 150;

// Politeness gap between feed pages during a deep crawl — a deep run makes many
// back-to-back feed requests, and X soft-blocks bursts, so space them out.
// Recent's short window doesn't need it.
const RESUME_PAGE_DELAY_MS = 250;

// Subfolder for items whose thread/article expansion was cut short by X's rate
// limit — they're written as root-only stubs, aren't ledgered, and a re-run
// completes them. Quarantining them here (and out of the combined/manifest)
// keeps them from masquerading as complete exports (issue #81). Named to signal
// both the state and the fix.
const INCOMPLETE_SUBFOLDER = '_incomplete_rerun_to_complete';

// Cap on the persisted incomplete-id list; it drains as items complete, so this
// only guards against a pathological run of rate limits growing it unbounded.
const INCOMPLETE_CAP = 2000;

// Phase-A trigger (no UI yet, like ADR 0002 batch): fetch the bookmarks
// timeline via GraphQL, map each tweet to the AST, expand Articles/threads via
// per-item TweetDetail, then postProcess + write through the SHARED sinks
// (per-item files / combined / data.json) using the user's batch settings.
// Honors the dedup ledger and the hard item cap. Console:
//   await xclipperFastBatch()                       // full (threads + articles)
//   await xclipperFastBatch({ expandThreads: false }) // fastest, root-only
async function runFastBatchExport(opts: FastBatchOptions = {}): Promise<FastBatchResult | null> {
  const maxItems = opts.maxItems ?? FAST_BATCH_MAX_ITEMS;
  const expandThreads = opts.expandThreads ?? true;
  const source = opts.source ?? 'bookmarks';
  const handleRaw = opts.handle?.replace(/^@/, ''); // original case, for display
  const handle = handleRaw?.toLowerCase(); // for the repost filter
  const cfg = SOURCE_CONFIG[source];
  // Date bounds on the tweet date (inclusive). `to` extends to end-of-day.
  const fromMs = opts.fromDate ? Date.parse(opts.fromDate) : -Infinity;
  const toMs = opts.toDate ? Date.parse(opts.toDate) + 86399999 : Infinity;
  const dateFiltered = fromMs !== -Infinity || toMs !== Infinity;
  cancelRequested = false;
  setProgress({
    status: 'running',
    phase: `Fetching ${cfg.label}…`,
    source,
    ...(handleRaw ? { handle: handleRaw } : {}),
    done: 0,
    total: 0,
    exported: 0,
    skipped: 0,
    folder: undefined,
    rateLimited: false,
    needTweetDetail: false,
    error: undefined,
  });
  if (!(await requestFastBatchAccess())) {
    log('permission denied — Fast Batch needs the optional webRequest access');
    setProgress({ status: 'error', error: 'Permission denied — enable Fast Batch first.' });
    return null;
  }
  await restoreSession(); // reload captured auth/templates if the SW restarted
  // Fast Batch replays two captured requests: the source feed (bookmarks /
  // profile / likes), and (to expand threads/articles) TweetDetail. After an
  // extension reload neither has been seen yet. Check BOTH up front (before
  // paginating) and give one plain hint — the user does it once, then it works.
  const needFeed = !templates[cfg.op];
  const needTweetDetail = expandThreads && !templates.TweetDetail;
  if (needFeed || needTweetDetail) {
    const feedHint = `Reload your ${cfg.label} page`;
    const msg =
      needFeed && needTweetDetail
        ? `${feedHint} and open any one tweet, then click Export again.`
        : needFeed
          ? `${feedHint}, then click Export again.`
          : 'Open any one tweet, then click Export again.';
    log(`preconditions missing (${cfg.op}:${needFeed} tweetDetail:${needTweetDetail})`);
    setProgress({ status: 'error', needTweetDetail, error: msg });
    return null;
  }
  const template = templates[cfg.op];

  const settings = await loadSettings();
  // Profile: drop reposts unless the user opted to include them (matches Standard).
  const skipReposts = source === 'profile' && !settings.includeReposts;
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
  // Ids a previous rate-limited run left incomplete — retried by direct
  // TweetDetail fetch below (feed-independent, so Recent/Resume both finish them).
  const prevIncomplete = new Set(await loadIncomplete());
  let skipped = 0;

  // Recent starts from the top. Resume continues from this source's saved
  // frontier (deep backfill). Date range deep-scans from the top for a tweet-date
  // window — like Recent's start, but it must reach deep, so it shares Resume's
  // page budget and pacing without ever touching the resume cursor (#83).
  const paginate = opts.paginate ?? 'recent';
  const deepCrawl = paginate === 'resume' || paginate === 'dateRange';
  const vars = JSON.parse(getVariables(template)) as Record<string, unknown>;
  delete vars.cursor;
  const resumeCursors = await loadResumeCursors();
  if (paginate === 'resume' && resumeCursors[source]) vars.cursor = resumeCursors[source];
  const initialUrl = setVariablesParam(template, JSON.stringify(vars));
  // Frontier to persist for the next Resume run — advances only past pages we
  // fully consume (below); starts wherever this run started. Only Resume saves it.
  let frontier: string | null = (vars.cursor as string | undefined) ?? null;

  // 1) Collect: paginate the source feed, mapping each root tweet, skipping
  //    anything already exported. (Cheap — pure mapping, no per-item fetch yet.)
  //    `needsExpand` items get a TweetDetail fetch next; `ledger` decides whether
  //    to mark the item done (false = re-run should retry it). For a profile,
  //    `handle` is set and reposts (author ≠ handle) are skipped — matching
  //    Standard profile export.
  interface Item {
    doc: Document;
    needsExpand: boolean;
    ledger: boolean;
    // The id the FEED presented for this item — what next run's dedup check
    // uses. Expansion can replace doc.metadata.tweetId with a different
    // canonical id (edited tweets, re-rooted thread replies), so we must ledger
    // this one too or the post re-exports every run.
    feedId: string;
  }
  const selected: Item[] = [];
  // Resume and Date range crawl deep (past everything already exported, or down
  // to an old tweet-date window) so they get a large page ceiling; Recent only
  // scans the top.
  const maxPages = deepCrawl ? RESUME_MAX_PAGES : RECENT_MAX_PAGES;
  try {
    for await (const { tweetResults, cursor } of paginateTimeline(initialUrl, authedFetchJson, { maxPages })) {
      if (cancelRequested) break;
      let cappedMidPage = false;
      for (const raw of tweetResults) {
        if (selected.length >= maxItems) {
          cappedMidPage = true;
          break;
        }
        const doc = jsonToAst(raw);
        if (skipReposts && (isRepost(raw) || (handle && doc.metadata.author.handle.toLowerCase() !== handle))) {
          continue; // a retweet, or (rarely) a top-level original author ≠ owner
        }
        if (dateFiltered) {
          const d = Date.parse(doc.metadata.date);
          if (Number.isNaN(d) || d < fromMs || d > toMs) continue; // outside the range — skip (not expanded)
        }
        const id = doc.metadata.tweetId;
        if (id && ledger.has(id)) {
          skipped++;
          continue;
        }
        if (id && prevIncomplete.has(id)) continue; // retried by id below — don't double-collect
        const needsExpand = doc.metadata.type === 'article' || expandThreads;
        selected.push({ doc, needsExpand, ledger: !needsExpand, feedId: id });
      }
      // Advance the Resume frontier only past pages we fully consumed — a page
      // cut short by maxItems is re-fetched next run (the ledger dedups what we
      // already took), so no mid-page items are lost.
      if (!cappedMidPage) frontier = cursor;
      log(`fetched ${selected.length}${skipped ? ` (skipped ${skipped} already-exported)` : ''}`);
      setProgress({ done: selected.length, skipped });
      if (selected.length >= maxItems) break;
      // Space out a deep crawl (Resume / Date range) so many back-to-back feed
      // pages don't trip X's rate limit; Recent's short window skips the delay.
      if (deepCrawl) await sleep(RESUME_PAGE_DELAY_MS);
    }
  } catch (err) {
    // Partial export is honest — we still write whatever we collected.
    log('fetch stopped early:', err);
  }

  // 2) Complete the backlog FIRST: items a previous run left incomplete, by a
  //    DIRECT TweetDetail fetch by id — feed-independent, so they finish no
  //    matter where Recent/Resume paginated (issue #83). Success → a full
  //    Document, written to the root and ledgered; a permanent failure
  //    (deleted/protected) → dropped from the incomplete set; a rate-limit →
  //    stop and leave the rest pending. Running first means the limited
  //    TweetDetail budget always clears the backlog before fresh items.
  let rateLimited = false;
  const retryItems: Item[] = [];
  const gaveUp = new Set<string>(); // permanently-failed ids to drop from the incomplete set
  if (prevIncomplete.size > 0 && templates.TweetDetail) {
    const ids = [...prevIncomplete];
    setProgress({ phase: 'Expanding earlier items…', total: ids.length, done: 0 });
    let done = 0;
    await mapLimit(ids, TWEET_DETAIL_CONCURRENCY, async (id) => {
      if (rateLimited || cancelRequested) return; // budget spent / cancelled — leave pending
      try {
        const full = await fetchTweetDetailDoc(id); // sourceUrl derived from the response
        if (full) retryItems.push({ doc: full, needsExpand: false, ledger: true, feedId: id });
      } catch (err) {
        if (classify(err) === 'rate-limit') rateLimited = true;
        else gaveUp.add(id); // deleted/protected — nothing left to complete
      }
      setProgress({ done: ++done });
    });
    log(`completed ${retryItems.length}/${ids.length} earlier incomplete item(s)${gaveUp.size ? ` (${gaveUp.size} gone)` : ''}`);
  }

  // 3) Expand fresh items via per-item TweetDetail: Articles always (full body),
  //    other tweets when expandThreads. Articles go FIRST (their body only exists
  //    via TweetDetail). On the first rate-limit signal we STOP (rather than
  //    hammer X and degrade the user's session); stopped/rate-limited items are
  //    NOT ledgered, so a re-run retries them.
  const toExpand = selected.filter((s) => s.needsExpand);
  if (toExpand.length > 0 && !templates.TweetDetail) {
    // Abort before writing — otherwise we'd dump a folder of root-only stubs
    // that aren't ledgered and you'd re-export them all next run anyway.
    log('no TweetDetail request captured — open any one tweet, then re-run (nothing written)');
    setProgress({
      status: 'error',
      needTweetDetail: true,
      error: 'Open any one tweet, then click Export again.',
    });
    return null;
  } else if (toExpand.length > 0) {
    setProgress({ phase: 'Expanding threads & articles…', total: toExpand.length, done: 0 });
    const ordered = [...toExpand].sort(
      (a, b) => Number(b.doc.metadata.type === 'article') - Number(a.doc.metadata.type === 'article')
    );
    let expanded = 0;
    let unavailable = 0;
    let processed = 0;
    await mapLimit(ordered, TWEET_DETAIL_CONCURRENCY, async (s) => {
      if (rateLimited || cancelRequested) return; // budget spent / cancelled — leave pending
      try {
        const full = await fetchTweetDetailDoc(s.doc.metadata.tweetId, s.doc.metadata.sourceUrl);
        if (full) s.doc = full;
        s.ledger = true;
        expanded++;
      } catch (err) {
        if (classify(err) === 'rate-limit') {
          rateLimited = true; // stop opening new fetches; this item stays pending
        } else {
          s.ledger = true; // deleted/protected — the root tweet is the final answer
          unavailable++;
        }
      }
      setProgress({ done: ++processed });
    });
    log(`expanded ${expanded}/${toExpand.length} via TweetDetail${unavailable ? ` (${unavailable} unavailable, kept root)` : ''}`);
    const pending = toExpand.filter((s) => !s.ledger).length;
    if (rateLimited && pending > 0) {
      log(
        `hit X's TweetDetail rate limit — stopped to protect your session. ${pending} item(s) were exported as root tweet / article stub and were NOT marked done; re-run Fast Batch later (a few minutes) and the dedup ledger will fetch just those.`
      );
    }
  }

  // 4) Write. Completed backlog items (retryItems) go first, then this run's
  // fresh collection. On a normal/rate-limited run we write everything; on CANCEL
  // we write only the items actually processed (ledger=true), so "stop at 5"
  // yields ~5 files like Standard — the rest stay un-ledgered for a re-run.
  const allItems = [...retryItems, ...selected];
  const toWrite = cancelRequested ? allItems.filter((s) => s.ledger) : allItems;
  setProgress({ phase: 'Writing files…', total: toWrite.length, done: 0 });
  // Reliable (fully-expanded) items go in the run folder root and drive the
  // combined digest + data.json. Items whose expansion the rate limit cut short
  // (needsExpand && !ledger) are quarantined as loose files under
  // INCOMPLETE_SUBFOLDER — separate filename namespace, kept out of the ledger
  // and out of the combined/manifest — so a re-run completes them (issue #81).
  const usedFilenames: string[] = [];
  const stubFilenames: string[] = [];
  const items: StoredItem[] = [];
  // Carry the incomplete-id memory forward: drop ids that completed this run,
  // add ids still written as stubs — so next run expands the leftovers first.
  const nextIncomplete = new Set(prevIncomplete);
  let incomplete = 0;
  let processed = 0;
  for (const s of toWrite) {
    const { doc, feedId } = s;
    // Expansion can change the canonical id, so track both — see Item.feedId.
    const expandedId = doc.metadata.tweetId;
    const isStub = s.needsExpand && !s.ledger;
    const result = postProcess(docToExtracted(doc), {
      includeMetadata: settings.includeMetadata,
      downloadImages: resolveDownloadImages('download', settings.downloadImages),
      inlineStats: settings.inlineStats,
      obsidianFriendly: settings.obsidianFriendly,
      filenameTemplate: settings.filenameTemplate.trim(),
      frontmatterFields,
    });
    if (isStub) {
      const filename = uniqueFilename(stubFilenames, result.filename);
      stubFilenames.push(filename.toLowerCase());
      if (output !== 'combined') {
        const stubFolder = `${folder}/${INCOMPLETE_SUBFOLDER}`;
        writePerItem(stubFolder, format, filename, result.markdown, result.images, doc, settings);
      }
      if (feedId) nextIncomplete.add(feedId);
      incomplete++;
    } else {
      const filename = uniqueFilename(usedFilenames, result.filename);
      usedFilenames.push(filename.toLowerCase());
      if (output !== 'combined') {
        writePerItem(folder, format, filename, result.markdown, result.images, doc, settings);
      }
      items.push({ url: doc.metadata.sourceUrl, filename, doc });
      // Ledger BOTH ids the post can appear under, so the next run's feed dedups
      // it whichever id it presents (the feed id, or the canonical id).
      if (s.ledger) {
        if (feedId) ledgerArr = appendToLedger(ledgerArr, feedId);
        if (expandedId && expandedId !== feedId) ledgerArr = appendToLedger(ledgerArr, expandedId);
      }
      if (feedId) nextIncomplete.delete(feedId);
      if (expandedId) nextIncomplete.delete(expandedId);
    }
    setProgress({ done: ++processed });
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
  // Backlog items that came back deleted/protected are gone — stop tracking them.
  for (const id of gaveUp) nextIncomplete.delete(id);
  // Persisted regardless of items.length (an all-stub run still owes a re-run).
  await chrome.storage.local.set({
    [INCOMPLETE_LEDGER_KEY]: [...nextIncomplete].slice(-INCOMPLETE_CAP),
  });
  const cancelled = cancelRequested;
  // Resume: remember where to continue next time. Skip on cancel — a cancelled
  // run may have paginated past items it never wrote, and we must not skip those.
  if (paginate === 'resume' && !cancelled && frontier) {
    resumeCursors[source] = frontier;
    await chrome.storage.local.set({ [RESUME_CURSOR_KEY]: resumeCursors });
  }
  log(
    `${cancelled ? 'cancelled' : 'done'} — exported ${items.length}` +
      `${incomplete ? `, ${incomplete} incomplete (rate-limited) → ${INCOMPLETE_SUBFOLDER}/` : ''}` +
      ` → ${folder}/ (${skipped} skipped; ${format}/${output})`
  );
  setProgress({
    status: cancelled ? 'cancelled' : 'done',
    phase: cancelled ? 'Cancelled' : 'Done',
    exported: items.length,
    skipped,
    folder,
    rateLimited,
    total: toWrite.length,
    done: processed,
  });
  return { exported: items.length, skipped, folder };
}


// Debug/fixture capture: download the raw TweetDetail JSON for one status id,
// reusing the already-granted Fast Batch auth (no Network-tab fiddling). Console:
//   await xclipperDumpTweetDetail('2046902326657749114')
async function dumpTweetDetail(id: string): Promise<void> {
  if (!(await requestFastBatchAccess())) return void log('permission denied');
  const template = templates.TweetDetail;
  if (!template) return void log('no TweetDetail request seen yet — open any tweet once, then retry');
  const vars = JSON.parse(getVariables(template)) as Record<string, unknown>;
  vars.focalTweetId = id;
  delete vars.cursor;
  const json = await authedFetchJson(setVariablesParam(template, JSON.stringify(vars)));
  const url = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(json))))}`;
  await chrome.downloads.download({ url, filename: `xclipper-debug/tweetdetail-${id}.json` });
  log('dumped TweetDetail', id, '→ Downloads/xclipper-debug/');
}

export function initFastBatch(): void {
  void restoreSession();
  // Re-arm capture across service-worker restarts if access was already granted.
  void hasAccess().then((ok) => {
    if (ok) startCapturing();
  });
  chrome.permissions.onAdded.addListener((p) => {
    if (p.permissions?.includes('webRequest')) startCapturing();
  });
  // Phase-A triggers (see header).
  (globalThis as Record<string, unknown>).xclipperFastBatch = runFastBatchExport;
  (globalThis as Record<string, unknown>).xclipperDumpTweetDetail = dumpTweetDetail;

  // Popup → background controls (FAST_BATCH_*). Only extension pages may drive
  // these, same as the Standard batch messages.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const action = (msg as { action?: string }).action;
    if (
      action !== 'FAST_BATCH_START' &&
      action !== 'FAST_BATCH_STATUS' &&
      action !== 'FAST_BATCH_CANCEL' &&
      action !== 'FAST_BATCH_READY'
    ) {
      return false;
    }
    if (!isExtensionPageSender(sender, chrome.runtime.id)) {
      sendResponse({});
      return false;
    }
    if (action === 'FAST_BATCH_STATUS') {
      sendResponse({ progress } satisfies FastBatchStatusResponse);
      return false;
    }
    if (action === 'FAST_BATCH_READY') {
      const src = (msg as { source?: FastSource }).source ?? 'bookmarks';
      void (async () => {
        await restoreSession(); // templates may live in session storage after a SW restart
        sendResponse({
          feed: !!templates[SOURCE_CONFIG[src].op],
          tweetDetail: !!templates.TweetDetail,
        } satisfies FastBatchReadyResponse);
      })();
      return true; // async sendResponse
    }
    if (action === 'FAST_BATCH_CANCEL') {
      cancelRequested = true;
      sendResponse({});
      return false;
    }
    // FAST_BATCH_START
    if (progress.status === 'running') {
      sendResponse({ success: false, error: 'A Fast Batch run is already in progress.' } satisfies FastBatchStartResponse);
      return false;
    }
    const m = msg as {
      source?: FastSource;
      handle?: string;
      fromDate?: string;
      toDate?: string;
      expandThreads?: boolean;
      paginate?: 'recent' | 'resume' | 'dateRange';
    };
    void runFastBatchExport({
      ...(m.source ? { source: m.source } : {}),
      ...(m.handle ? { handle: m.handle } : {}),
      ...(m.fromDate ? { fromDate: m.fromDate } : {}),
      ...(m.toDate ? { toDate: m.toDate } : {}),
      ...(m.expandThreads === undefined ? {} : { expandThreads: m.expandThreads }),
      ...(m.paginate ? { paginate: m.paginate } : {}),
    });
    sendResponse({ success: true } satisfies FastBatchStartResponse);
    return false;
  });
}
