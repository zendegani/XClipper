import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { domToAst } from '../src/content/dom-to-ast';
import { extractTweetAsync } from '../src/content/tweet';
import type { Document, ThreadNode, TweetNode } from '../src/ast/types';

// A reply's permalink lists the posts it replies to above it, then the reply,
// then replies to it (issue #153). Synthetic posts only — no real accounts.
const post = (id: string, handle: string, text: string) => `
  <div data-testid="cellInnerDiv">
    <article role="article" data-testid="tweet">
      <div data-testid="User-Name">
        <a href="/${handle}"><span>${handle} name</span></a>
        <a href="/${handle}"><span>@${handle}</span></a>
      </div>
      <a href="/${handle}/status/${id}"><time datetime="2026-01-0${id}T00:00:00.000Z"></time></a>
      <div data-testid="tweetText">${text}</div>
    </article>
  </div>`;

function loadPage(focal: { id: string; handle: string }, posts: string[]): void {
  const url = `https://x.com/${focal.handle}/status/${focal.id}`;
  const dom = new JSDOM(`<html><body><main>${posts.join('')}</main></body></html>`, { url });
  document.documentElement.replaceWith(dom.window.document.documentElement.cloneNode(true) as HTMLElement);
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: new URL(url).pathname, href: url },
    writable: true,
    configurable: true,
  });
}

const ids = (doc: Document) =>
  doc.body.type === 'thread' ? (doc.body as ThreadNode).tweets.map((t) => t.tweetId) : [(doc.body as TweetNode).tweetId];

const cases = [
  {
    name: 'exports the requested reply, not the post it replies to',
    focal: { id: '2', handle: 'bob' },
    posts: [post('1', 'alice', 'parent'), post('2', 'bob', 'the reply'), post('3', 'carol', 'a reply to bob')],
    type: 'tweet',
    author: 'bob',
    tweets: ['2'],
    context: ['1'],
  },
  {
    name: 'roots a mid-thread request at the thread start',
    focal: { id: '2', handle: 'alice' },
    posts: [post('1', 'alice', 'first'), post('2', 'alice', 'second'), post('3', 'alice', 'third'), post('4', 'bob', 'reply')],
    type: 'thread',
    author: 'alice',
    tweets: ['1', '2', '3'],
    context: [],
  },
  {
    name: 'stops walking back at another author, even when the thread author posted earlier',
    focal: { id: '3', handle: 'alice' },
    posts: [post('1', 'alice', 'old post'), post('2', 'bob', 'reply'), post('3', 'alice', 'new post'), post('4', 'alice', 'more')],
    type: 'thread',
    author: 'alice',
    tweets: ['3', '4'],
    context: ['1', '2'],
  },
  {
    name: 'takes the posts above a self-thread as its context',
    focal: { id: '3', handle: 'alice' },
    posts: [post('1', 'bob', 'question'), post('2', 'alice', 'first'), post('3', 'alice', 'second'), post('4', 'carol', 'reply')],
    type: 'thread',
    author: 'alice',
    tweets: ['2', '3'],
    context: ['1'],
  },
];

// The posts a reply answers (issue #154); none for a post that answers nothing.
const contextIds = (doc: Document) => (doc.context ?? []).map((t) => t.tweetId);

describe('domToAst() on a reply permalink', () => {
  for (const c of cases) {
    it(c.name, () => {
      loadPage(c.focal, c.posts);
      const doc = domToAst();
      expect(doc.metadata.type).toBe(c.type);
      expect(doc.metadata.author.handle).toBe(c.author);
      expect(ids(doc)).toEqual(c.tweets);
      expect(contextIds(doc)).toEqual(c.context);
    });
  }

  it('keeps the context of a single-post export', () => {
    loadPage({ id: '3', handle: 'bob' }, [post('1', 'alice', 'root'), post('2', 'carol', 'parent'), post('3', 'bob', 'the reply')]);
    const doc = domToAst({ singleTweet: true });
    expect(ids(doc)).toEqual(['3']);
    expect(contextIds(doc)).toEqual(['1', '2']);
  });

  it('adds no context key to a post that answers nothing', () => {
    loadPage({ id: '1', handle: 'alice' }, [post('1', 'alice', 'lone'), post('2', 'bob', 'reply')]);
    expect('context' in domToAst()).toBe(false);
  });
});

// The full Manual path: loadThreadIntoDom captures the thread into an
// off-screen host, which domToAst then reads ahead of the live page.
describe('extractTweetAsync() on a reply permalink', () => {
  for (const c of cases) {
    it(c.name, async () => {
      loadPage(c.focal, c.posts);
      const res = await extractTweetAsync();
      const doc = res.body as Document;
      expect(doc.metadata.type).toBe(c.type);
      expect(doc.metadata.author.handle).toBe(c.author);
      expect(ids(doc)).toEqual(c.tweets);
      expect(contextIds(doc)).toEqual(c.context);
    });
  }
});
