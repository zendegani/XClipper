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
  };
}

// The timeline lives under different data keys per source; check the known ones.
function findTimeline(raw: unknown): RawTimeline | null {
  const d = (raw as { data?: Record<string, unknown> } | null)?.data;
  if (!d) return null;
  const paths: (RawTimeline | undefined)[] = [
    (d.bookmark_timeline_v2 as { timeline?: RawTimeline })?.timeline,
    (d.bookmark_timeline as { timeline?: RawTimeline })?.timeline,
    (d.user as { result?: { timeline_v2?: { timeline?: RawTimeline } } })?.result?.timeline_v2?.timeline,
    (d.user as { result?: { timeline?: { timeline?: RawTimeline } } })?.result?.timeline?.timeline,
  ];
  return paths.find((t): t is RawTimeline => !!t?.instructions) ?? null;
}

export function parseTimelinePage(raw: unknown): TimelinePage {
  const timeline = findTimeline(raw);
  const entries: RawEntry[] = (timeline?.instructions ?? [])
    .filter((i) => i.type === 'TimelineAddEntries')
    .flatMap((i) => i.entries ?? []);

  const tweetResults: unknown[] = [];
  let bottomCursor: string | null = null;
  for (const e of entries) {
    if (e.entryId?.startsWith('tweet-')) {
      const result = e.content?.itemContent?.tweet_results?.result;
      if (result != null) tweetResults.push(result);
    } else if (e.content?.cursorType === 'Bottom' && typeof e.content.value === 'string') {
      bottomCursor = e.content.value;
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
): AsyncGenerator<unknown[]> {
  const maxPages = opts.maxPages ?? 50;
  let url = initialUrl;
  for (let page = 0; page < maxPages; page++) {
    const { tweetResults, bottomCursor, done } = parseTimelinePage(await fetchJson(url));
    if (tweetResults.length > 0) yield tweetResults;
    if (done || !bottomCursor) return;
    url = setVariablesParam(url, withCursor(getVariables(url), bottomCursor));
  }
}
