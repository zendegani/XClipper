// Fast Batch (ADR 0003): pure parsing + cursor pagination for X's internal
// GraphQL timeline responses (bookmarks/likes/profile). No DOM, no Chrome APIs
// — the network transport is injected into `paginateTimeline`, so the whole
// loop is unit-testable. The raw tweet objects this yields feed `jsonToAst`.
//
// Shapes validated against a real captured Bookmarks response:
//   data.bookmark_timeline_v2.timeline.instructions[type=TimelineAddEntries]
//     .entries[] — entryId "tweet-<id>" → content.itemContent.tweet_results.result
//                  entryId "cursor-bottom-<id>" → content.value (next-page cursor)
// A page with no "tweet-" entries (only the two cursors) is the end of the feed.

export interface TimelinePage {
  // Raw tweet_results.result objects, in feed order, for jsonToAst.
  tweetResults: unknown[];
  // Cursor to request the next (older) page, or null if none was present.
  bottomCursor: string | null;
  // True when the feed is exhausted (this page carried no tweets).
  done: boolean;
}

interface RawTimeline {
  instructions?: { type?: string; entries?: RawEntry[] }[];
}
interface RawEntry {
  entryId?: string;
  content?: {
    entryType?: string;
    cursorType?: string;
    value?: string;
    itemContent?: { tweet_results?: { result?: unknown } };
    // Profile/likes self-thread cells wrap tweets in a module's `items`.
    items?: { item?: { itemContent?: { tweet_results?: { result?: unknown } } } }[];
  };
}

// The timeline lives under different data keys per source (bookmarks, profile,
// likes…). Check the known keys, then fall back to a generic search for the
// `instructions` array so a new source works without a hardcoded path.
function findTimeline(raw: unknown): RawTimeline | null {
  const d = (raw as { data?: Record<string, unknown> } | null)?.data;
  if (!d) return null;
  const known: (RawTimeline | undefined)[] = [
    (d.bookmark_timeline_v2 as { timeline?: RawTimeline })?.timeline,
    (d.bookmark_timeline as { timeline?: RawTimeline })?.timeline,
    (d.user as { result?: { timeline_v2?: { timeline?: RawTimeline } } })?.result?.timeline_v2?.timeline,
    (d.user as { result?: { timeline?: { timeline?: RawTimeline } } })?.result?.timeline?.timeline,
  ];
  return known.find((t): t is RawTimeline => !!t?.instructions) ?? searchTimeline(d);
}

// Depth-limited search for the first object carrying an `instructions` array.
function searchTimeline(o: unknown, depth = 0): RawTimeline | null {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  const obj = o as Record<string, unknown>;
  if (Array.isArray(obj.instructions)) return obj as RawTimeline;
  for (const v of Object.values(obj)) {
    const found = searchTimeline(v, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseTimelinePage(raw: unknown): TimelinePage {
  const timeline = findTimeline(raw);
  const entries: RawEntry[] = (timeline?.instructions ?? [])
    .filter((i) => i.type === 'TimelineAddEntries')
    .flatMap((i) => i.entries ?? []);

  const tweetResults: unknown[] = [];
  let bottomCursor: string | null = null;
  for (const e of entries) {
    const c = e.content;
    if (c?.cursorType === 'Bottom' && typeof c.value === 'string') {
      bottomCursor = c.value;
      continue;
    }
    // A plain tweet cell, or a module (self-thread) wrapping several tweets.
    const top = c?.itemContent?.tweet_results?.result;
    if (top != null) {
      tweetResults.push(top);
      continue;
    }
    for (const it of c?.items ?? []) {
      const r = it.item?.itemContent?.tweet_results?.result;
      if (r != null) tweetResults.push(r);
    }
  }
  return { tweetResults, bottomCursor, done: tweetResults.length === 0 };
}

// ─── Request URL helpers (X timelines are GET with `variables` JSON) ─

export function getVariables(url: string): string {
  return new URL(url).searchParams.get('variables') ?? '{}';
}

export function withCursor(variables: string, cursor: string): string {
  const v = JSON.parse(variables) as Record<string, unknown>;
  v.cursor = cursor;
  return JSON.stringify(v);
}

export function setVariablesParam(url: string, variables: string): string {
  const u = new URL(url);
  u.searchParams.set('variables', variables);
  return u.toString();
}

// ─── Pagination loop (transport injected) ───────────────────────────
//
// Drives a captured timeline request forward by cursor, yielding each page's
// raw tweets. `fetchJson` is the only impure dependency — in production it is a
// fetch carrying the session's captured auth headers (wired next); in tests it
// is a canned-page stub. Stops at the end of the feed, a missing cursor, or
// maxPages (a hard safety cap mirroring the batch item cap).

export async function* paginateTimeline(
  initialUrl: string,
  fetchJson: (url: string) => Promise<unknown>,
  opts: { maxPages?: number } = {}
): AsyncGenerator<{ tweetResults: unknown[]; cursor: string | null }> {
  const maxPages = opts.maxPages ?? 50;
  let url = initialUrl;
  for (let page = 0; page < maxPages; page++) {
    const { tweetResults, bottomCursor, done } = parseTimelinePage(await fetchJson(url));
    // `cursor` is the cursor to fetch the page AFTER this one — the resume
    // frontier once this page has been fully consumed (issue #83).
    if (tweetResults.length > 0) yield { tweetResults, cursor: bottomCursor };
    if (done || !bottomCursor) return;
    url = setVariablesParam(url, withCursor(getVariables(url), bottomCursor));
  }
}
