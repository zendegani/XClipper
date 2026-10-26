// Fill in the full text of the posts X showed only as a preview (issue #184).
//
// On a permalink X shows the requested post in full and cuts every other post
// at about 280 characters, so single export asks here for the rest. Two ways,
// tried in order:
//
//   1. When Media or Auto already granted webRequest, TweetDetail carries the
//      full text (`note_tweet`) of the whole conversation — one call for the
//      requested post, plus one per post it didn't carry (an article's embeds).
//   2. Otherwise, or for whatever that left, open each post's own page in an
//      unfocused window, where X shows it in full, and read it with the DOM
//      extractor (content.ts, `#xclipper=fulltext`).
//
// Best-effort, like resolve-video.ts: a post neither way fills stays cut off,
// and the renderers end it with a link to the post.

import type { InlineNode, TweetNode } from '../ast/types';
import type {
  FullTextResultMessage,
  ResolveFullTextRequest,
  ResolveFullTextResponse,
} from '../types/messages';
import { jsonToTweetNode } from '../graphql/json-to-ast';
import { flattenTweetDetail } from '../graphql/tweet-detail';
import { fetchTweetDetailJson } from './graphql-batch';
import { hasAccess, restoreSession } from './x-session';

const log = (...args: unknown[]): void => console.log('[xclipper full-text]', ...args);

type Post = ResolveFullTextRequest['posts'][number];
const PAGE_TIMEOUT_MS = 20000;

export async function resolveFullText(msg: ResolveFullTextRequest): Promise<ResolveFullTextResponse> {
  // Both go into an x.com URL below.
  const posts = msg.posts.filter((p) => /^\d+$/.test(p.tweetId) && /^\w+$/.test(p.handle));
  const texts = new Map<string, InlineNode[]>();
  if (posts.length === 0) return { texts: [] };

  await fromTweetDetail(msg.tweetId, posts, texts);
  await fromPostPages(posts.filter((p) => !texts.has(p.tweetId)), texts);
  return { texts: [...texts] };
}

async function fromTweetDetail(
  tweetId: string,
  posts: Post[],
  texts: Map<string, InlineNode[]>
): Promise<void> {
  await restoreSession();
  if (!(await hasAccess())) return;

  const wanted = new Set(posts.map((p) => p.tweetId));
  const keep = (node: TweetNode): void => {
    if (wanted.has(node.tweetId)) texts.set(node.tweetId, node.text);
    if (node.quotedTweet) keep(node.quotedTweet);
  };
  try {
    for (const id of [tweetId, ...wanted]) {
      if (texts.size === wanted.size) return;
      if (texts.has(id)) continue;
      const json = await fetchTweetDetailJson(id);
      if (!json) return; // no TweetDetail request observed yet
      for (const result of flattenTweetDetail(json)) keep(jsonToTweetNode(result));
    }
  } catch (err) {
    log('TweetDetail failed, reading the posts from their pages:', err);
  }
}

// Post id → the waiting fromPostPages step, settled by FULL_TEXT_RESULT.
const waiting = new Map<string, (text: InlineNode[] | undefined) => void>();

// One window for every post, like the Scroll batch worker: unfocused, so the
// popup stays open, and wide enough for X's full layout. Stops at the first
// page that gives no text: a sign-in or rate-limit page would block every
// post after it too, and each one costs the full wait.
async function fromPostPages(posts: Post[], texts: Map<string, InlineNode[]>): Promise<void> {
  let windowId: number | undefined;
  let tabId: number | undefined;
  try {
    for (const post of posts) {
      const text = new Promise<InlineNode[] | undefined>((resolve) => {
        const settle = (value: InlineNode[] | undefined): void => {
          clearTimeout(timer);
          waiting.delete(post.tweetId);
          resolve(value);
        };
        const timer = setTimeout(() => settle(undefined), PAGE_TIMEOUT_MS);
        waiting.set(post.tweetId, settle);
      });
      const url = `https://x.com/${post.handle}/status/${post.tweetId}#xclipper=fulltext`;
      if (tabId === undefined) {
        const win = await chrome.windows.create({ url, focused: false, type: 'popup', width: 1100, height: 900 });
        windowId = win?.id;
        tabId = win?.tabs?.[0]?.id;
        // Without the tab, the next post would open a second window.
        if (tabId === undefined) throw new Error('the window opened without a tab');
      } else {
        await chrome.tabs.update(tabId, { url });
      }
      const full = await text;
      if (!full?.length) {
        log('no full text from the page of', post.tweetId, '— leaving the rest cut off');
        return;
      }
      texts.set(post.tweetId, full);
    }
  } catch (err) {
    log('reading posts from their pages stopped:', err);
  } finally {
    if (windowId !== undefined) await chrome.windows.remove(windowId).catch(() => {});
  }
}

export function receiveFullText(msg: FullTextResultMessage): void {
  waiting.get(msg.tweetId)?.(msg.text);
}
