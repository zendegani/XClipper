// X session auth + authed transport for Fast Batch (ADR 0003). We never ask for
// a password or a paid API key: with the opt-in `webRequest` permission granted,
// we observe the auth headers the browser ALREADY sends on the user's own x.com
// GraphQL requests, remember the request templates, and replay them ourselves.
//
// This is the impure edge (webRequest, fetch, permissions, storage); fast-batch
// orchestrates on top of it. `templates` is exported live — captureHeaders keeps
// it current and the orchestrator reads it to know which requests it can replay.

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
export const templates: Record<string, string> = {};
let listening = false;

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
export async function restoreSession(): Promise<void> {
  const r = await chrome.storage.session.get([SESSION_AUTH_KEY, SESSION_TEMPLATES_KEY]);
  if (!auth && r[SESSION_AUTH_KEY]) auth = r[SESSION_AUTH_KEY] as XAuth;
  const saved = r[SESSION_TEMPLATES_KEY] as Record<string, string> | undefined;
  if (saved) for (const k of Object.keys(saved)) templates[k] ??= saved[k];
}

export function startCapturing(): void {
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

export async function hasAccess(): Promise<boolean> {
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

export async function authedFetchJson(url: string): Promise<unknown> {
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
export class GraphqlError extends Error {
  constructor(messages: string[]) {
    super(`X GraphQL error: ${messages.join('; ')}`);
  }
}

export type ErrorKind = 'rate-limit' | 'transient' | 'permanent';

// 429 and GraphQL error envelopes mean the account is being throttled — stop
// spending the TweetDetail budget. 5xx / network blips are transient (retry). A
// 4xx (deleted/protected tweet) or a mapping miss is permanent (keep the root).
export function classify(err: unknown): ErrorKind {
  if (err instanceof HttpError) return err.status === 429 ? 'rate-limit' : err.status >= 500 ? 'transient' : 'permanent';
  if (err instanceof GraphqlError) return 'rate-limit';
  if (err instanceof TypeError) return 'transient'; // fetch network failure
  return 'permanent';
}
