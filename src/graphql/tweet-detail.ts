// Fast Batch (ADR 0003) — map an X `TweetDetail` response to a Document.
//
// TweetDetail (data.threaded_conversation_with_injections_v2) is the per-item
// fetch that fills the gaps the bookmarks timeline can't: a self-thread's
// continuation tweets, and (next) an Article's full body. The self-thread is the
// focal author's run of posts around the focal tweet, stopping at the first
// different-author tweet — the reply boundary — exactly like the DOM extractor's
// loadThreadIntoDom. Each tweet is mapped by the shared jsonToTweetNode, so
// quotes/media/cards/long-form all work for free.

import type { Document, TweetNode } from '../ast/types';
import type { EmbeddedTweets } from './json-to-ast';
import { articleEmbeddedTweetIds, jsonToAst, jsonToTweetNode } from './json-to-ast';

interface RawEntry {
  content?: {
    entryType?: string;
    itemContent?: { tweet_results?: { result?: unknown } };
    items?: { item?: { itemContent?: { tweet_results?: { result?: unknown } } } }[];
  };
}

function unwrap(r: unknown): { article?: unknown } & Record<string, unknown> {
  const x = (r ?? {}) as { __typename?: string; tweet?: unknown };
  return (x.__typename === 'TweetWithVisibilityResults' && x.tweet ? x.tweet : r) as Record<string, unknown>;
}

// Flatten the conversation into tweet_results.result objects in display order:
// each TimelineTimelineItem (the posts a reply replies to, then the focal post),
// then each TimelineTimelineModule's items (skipping show-more cursors, which
// carry no tweet_results).
export function flattenTweetDetail(raw: unknown): unknown[] {
  const instructions =
    (raw as { data?: { threaded_conversation_with_injections_v2?: { instructions?: { type?: string; entries?: RawEntry[] }[] } } })
      .data?.threaded_conversation_with_injections_v2?.instructions ?? [];
  const entries = instructions
    .filter((i) => i.type === 'TimelineAddEntries')
    .flatMap((i) => i.entries ?? []);

  const out: unknown[] = [];
  for (const e of entries) {
    const c = e.content;
    if (c?.entryType === 'TimelineTimelineItem') {
      const r = c.itemContent?.tweet_results?.result;
      if (r != null) out.push(r);
    } else if (c?.entryType === 'TimelineTimelineModule') {
      for (const it of c.items ?? []) {
        const r = it.item?.itemContent?.tweet_results?.result;
        if (r != null) out.push(r);
      }
    }
  }
  return out;
}

// Where the requested post sits in the flattened conversation. Not always
// first: for a reply, X lists the posts it replies to before it (issue #150).
// Throws rather than guess — exporting some other post as this one is worse
// than the caller's fallback.
function focalIndex(results: unknown[], focalId: string): number {
  const i = results.findIndex((r) => unwrap(r).rest_id === focalId);
  if (i < 0) throw new Error(`TweetDetail did not carry the requested post ${focalId}`);
  return i;
}

// The ids of the posts embedded in this response's Article body. The article
// payload names them but carries none of their content, so the caller fetches
// each one and hands the results back through `tweetDetailToDocument`'s
// `embeds` (issue #123). Empty for anything that isn't a full Article body.
export function tweetDetailEmbeddedTweetIds(raw: unknown, focalId: string): string[] {
  const results = flattenTweetDetail(raw);
  return results.length === 0 ? [] : articleEmbeddedTweetIds(results[focalIndex(results, focalId)]);
}

// The focal tweet as a TweetNode — how an embedded post is mapped once its own
// TweetDetail comes back.
export function tweetDetailFocalTweetNode(raw: unknown, focalId: string): TweetNode {
  const results = flattenTweetDetail(raw);
  if (results.length === 0) throw new Error('TweetDetail carried no tweets');
  return jsonToTweetNode(results[focalIndex(results, focalId)]);
}

// The requested tweet → its full Document. A multi-tweet self-thread becomes a
// ThreadNode; a lone tweet (or an Article focal) falls back to jsonToAst, which
// already handles single tweets and the Article stub/full body.
export function tweetDetailToDocument(
  raw: unknown,
  focalId: string,
  sourceUrl?: string,
  embeds?: EmbeddedTweets
): Document {
  const results = flattenTweetDetail(raw);
  if (results.length === 0) throw new Error('TweetDetail carried no tweets');
  const focal = focalIndex(results, focalId);

  // Articles are mapped by jsonToAst (stub today, full body next), not threaded.
  if (unwrap(results[focal]).article) return jsonToAst(results[focal], sourceUrl, embeds);

  // The self-thread runs back through the focal author's own earlier posts (a
  // mid-thread request exports from the thread's start) and forward through
  // their continuation. Another author's post bounds it either way.
  const nodes = results.map((r) => jsonToTweetNode(r));
  const handle = nodes[focal].author.handle.toLowerCase();
  const byAuthor = (n: TweetNode) => n.author.handle.toLowerCase() === handle;
  let start = focal;
  while (start > 0 && byAuthor(nodes[start - 1])) start--;
  let end = focal + 1;
  while (end < nodes.length && byAuthor(nodes[end])) end++;
  const thread = nodes.slice(start, end);

  if (thread.length <= 1) return jsonToAst(results[focal], sourceUrl);

  const root = thread[0];
  return {
    version: 1,
    metadata: {
      type: 'thread',
      sourceUrl: sourceUrl ?? `https://x.com/${root.author.handle}/status/${root.tweetId}`,
      tweetId: root.tweetId,
      author: root.author,
      date: root.date,
      ...(root.engagement ? { engagement: root.engagement } : {}),
    },
    body: { type: 'thread', tweets: thread },
  };
}
