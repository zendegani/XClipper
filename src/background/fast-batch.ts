// Fast Batch (ADR 0003) — live acquisition half, Phase A (console-triggerable,
// no UI yet, mirroring how ADR 0002 batch shipped first).
//
// We never ask for a password or a paid API key. With the opt-in `webRequest`
// permission granted, we observe the auth headers the browser ALREADY sends on
// your own x.com GraphQL requests, then replay the timeline endpoint ourselves —
// paginating by cursor (timeline.ts) and mapping each tweet to the AST
// (jsonToAst), so the existing renderers/sinks apply unchanged.
//
// This module is impure (webRequest, fetch, permissions) and therefore not
// unit-tested — its pure dependencies (parse/paginate/map) are. Verify it live:
//   1) chrome://extensions → XClipper → service worker (Inspect)
//   2) await xclipperFastBatch()      // grants permission, then walks bookmarks
// If it says no request was captured, open https://x.com/i/bookmarks, scroll
// once, and re-run.

import { jsonToAst } from '../graphql/json-to-ast';
import { paginateTimeline } from '../graphql/timeline';

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

  const op = details.url.match(/\/graphql\/[^/]+\/(Bookmarks|Likes|UserTweets)\b/)?.[1];
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

// Phase-A console harness: prove the live fetch→paginate→map path end to end
// before any UI/sink exists. Returns mapped handles/ids so it's easy to eyeball.
async function fastBatchTest(maxPages = 2): Promise<string[]> {
  if (!(await requestFastBatchAccess())) {
    log('permission denied — Fast Batch needs the optional webRequest access');
    return [];
  }
  const template = templates.Bookmarks;
  if (!template) {
    log('no Bookmarks request seen yet — open https://x.com/i/bookmarks, scroll once, then re-run');
    return [];
  }
  const refs: string[] = [];
  for await (const tweets of paginateTimeline(template, authedFetchJson, { maxPages })) {
    for (const t of tweets) {
      const doc = jsonToAst(t);
      refs.push(`${doc.metadata.author.handle}/${doc.metadata.tweetId}`);
    }
    log(`page: +${tweets.length} (total ${refs.length})`);
  }
  log(`done — mapped ${refs.length} tweets; first: ${refs.slice(0, 3).join(', ')}`);
  return refs;
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
  (globalThis as Record<string, unknown>).xclipperFastBatch = fastBatchTest;
}
