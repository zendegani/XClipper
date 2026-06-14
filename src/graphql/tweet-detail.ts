// Fast Batch (ADR 0003) — map an X `TweetDetail` response to a Document.
//
// TweetDetail (data.threaded_conversation_with_injections_v2) is the per-item
// fetch that fills the gaps the bookmarks timeline can't: a self-thread's
// continuation tweets, and (next) an Article's full body. The self-thread is the
// focal tweet plus the author's own continuation, stopping at the first
// different-author tweet — the reply boundary — exactly like the DOM extractor's
// loadThreadIntoDom. Each tweet is mapped by the shared jsonToTweetNode, so
// quotes/media/cards/long-form all work for free.

import type { Document, TweetNode } from '../ast/types';
import { jsonToAst, jsonToTweetNode } from './json-to-ast';

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
// the focal TimelineTimelineItem, then each TimelineTimelineModule's items
// (skipping show-more cursors, which carry no tweet_results).
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

// A focal tweet → its full Document. A multi-tweet self-thread becomes a
// ThreadNode; a lone tweet (or an Article focal) falls back to jsonToAst, which
// already handles single tweets and the Article stub/full body.
export function tweetDetailToDocument(raw: unknown, sourceUrl?: string): Document {
  const results = flattenTweetDetail(raw);
  if (results.length === 0) throw new Error('TweetDetail carried no tweets');

  // Articles are mapped by jsonToAst (stub today, full body next), not threaded.
  if (unwrap(results[0]).article) return jsonToAst(results[0], sourceUrl);

  const nodes = results.map((r) => jsonToTweetNode(r));
  const focalHandle = nodes[0].author.handle.toLowerCase();
  const thread: TweetNode[] = [];
  for (const n of nodes) {
    if (n.author.handle.toLowerCase() !== focalHandle) break; // reply boundary
    thread.push(n);
  }

  if (thread.length <= 1) return jsonToAst(results[0], sourceUrl);

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
