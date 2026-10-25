import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { extract } from '../src/content/content';
import { extractTweetAsync } from '../src/content/tweet';
import type { Document, ThreadNode, TweetNode } from '../src/ast/types';

// Build a single <article> belonging to @alice (or `handle`), given its id,
// time iso and tweet text. The author block matches what
// extractAuthorFromArticle parses.
function tweetArticle(id: string, iso: string, text: string, handle = 'alice', engagement = ''): string {
  return `
    <article role="article" data-tid="${id}">
      <div data-testid="User-Name">
        <a href="/${handle}"><span>${handle[0].toUpperCase() + handle.slice(1)}</span></a>
        <a href="/${handle}"><span>@${handle}</span></a>
      </div>
      <a href="/${handle}/status/${id}"><time datetime="${iso}">…</time></a>
      <div data-testid="tweetText"><span>${text}</span></div>
      ${engagement}
    </article>
  `;
}

// Tombstone: an article without a User-Name (X renders these for deleted
// parents / hidden replies). extractAuthorFromArticle returns handle "unknown".
function tombstoneArticle(): string {
  return `
    <article role="article" data-tid="tombstone">
      <div>This Tweet is unavailable</div>
    </article>
  `;
}

function pointLocationAt(id: string): void {
  const url = `https://x.com/alice/status/${id}`;
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: `/alice/status/${id}`, href: url, hash: '' },
    writable: true,
    configurable: true,
  });
}

describe('thread-walk: deep-link upward walk', () => {
  const originalScrollTo = window.scrollTo;

  beforeEach(() => {
    // Initial DOM has only the focused tweet (#5) — X's deep-link behaviour.
    document.body.innerHTML = tweetArticle('5', '2026-05-01T00:05:00.000Z', 'tweet five');
    pointLocationAt('5');

    // Each scrollTo({top:0}) prepends one ancestor, simulating X lazy-loading
    // ancestors above the focused anchor. Stops after the root (#1) is in DOM.
    const ancestors = [
      tweetArticle('4', '2026-05-01T00:04:00.000Z', 'tweet four'),
      tweetArticle('3', '2026-05-01T00:03:00.000Z', 'tweet three'),
      tweetArticle('2', '2026-05-01T00:02:00.000Z', 'tweet two'),
      tweetArticle('1', '2026-05-01T00:01:00.000Z', 'tweet one'),
    ];
    window.scrollTo = ((opts?: { top?: number }) => {
      if (opts && opts.top === 0 && ancestors.length > 0) {
        const next = ancestors.shift()!;
        document.body.insertAdjacentHTML('afterbegin', next);
      }
    }) as typeof window.scrollTo;
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
  });

  it('walks up to the root and collects the full chain', async () => {
    const res = await extract({});
    expect(res.success).toBe(true);
    expect(res.data?.type).toBe('thread');
    const md = res.data?.markdown || '';
    for (const t of ['tweet one', 'tweet two', 'tweet three', 'tweet four', 'tweet five']) {
      expect(md).toContain(t);
    }
    // Order: root first.
    expect(md.indexOf('tweet one')).toBeLessThan(md.indexOf('tweet five'));
  });
});

describe('thread-walk: tombstone is not a boundary', () => {
  beforeEach(() => {
    // alice's thread with a tombstone between tweets #1 and #3 (a deleted
    // or hidden reply). The walk must skip the tombstone, not stop on it.
    document.body.innerHTML =
      tweetArticle('1', '2026-05-01T00:01:00.000Z', 'tweet one') +
      tombstoneArticle() +
      tweetArticle('3', '2026-05-01T00:03:00.000Z', 'tweet three');
    pointLocationAt('1');
  });

  it('skips tombstone articles instead of terminating the walk', async () => {
    const res = await extract({});
    expect(res.success).toBe(true);
    expect(res.data?.type).toBe('thread');
    const md = res.data?.markdown || '';
    expect(md).toContain('tweet one');
    expect(md).toContain('tweet three');
  });
});

// Real-world regression: in the trq212 thread, Thariq replies to NeetCode's
// comment with "thank you! means a lot". DOM order on the page is:
//   …thread tweets… → NeetCode (different author) → Thariq "thank you!" reply
// The bounded captureArticles in tweet.ts must stop AT NeetCode, so the
// "thank you!" reply never gets captured, never gets rehydrated, and never
// appears in the output. -d.html is the chunk that includes those comments.
// It no longer holds the thread's first post, so the request points at the
// first thread post it does hold; a missing requested post fails the export
// (issue #182).
describe('thread-walk: same-author reply after the comment boundary', () => {
  const originalScrollTo = window.scrollTo;
  const fixturePath = resolve(__dirname, 'fixtures/trq212-2035372716820218141-d.html');
  const hasFixture = existsSync(fixturePath);
  beforeEach(() => {
    if (!hasFixture) return;
    window.scrollTo = (() => {}) as typeof window.scrollTo;
    const html = readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(html, {
      url: 'https://x.com/trq212/status/2035372725921882119',
    });
    document.documentElement.replaceWith(
      dom.window.document.documentElement.cloneNode(true) as HTMLElement,
    );
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        pathname: '/trq212/status/2035372725921882119',
        href: 'https://x.com/trq212/status/2035372725921882119',
        hash: '',
      },
      writable: true,
      configurable: true,
    });
  });
  afterEach(() => {
    window.scrollTo = originalScrollTo;
  });

  it('does not include the author\'s reply that sits past the comment boundary', async () => {
    if (!hasFixture) {
      console.warn(
        `\n  ⚠️  skipping comment-boundary regression — fixture trq212-2035372716820218141-d.html missing.\n  ` +
          `Drop the page's outerHTML into tests/fixtures/ and re-run to exercise this case.\n`,
      );
      return;
    }
    const res = await extract({});
    expect(res.success).toBe(true);
    const md = res.data?.markdown || '';
    // The reply text itself MUST be absent.
    expect(md).not.toContain('thank you! means a lot');
    // And the comment author MUST NOT appear (they're past the boundary).
    expect(md).not.toContain('NeetCode');
    expect(md).not.toContain('@neetcode1');
  });
});

// X virtualizes the timeline: only the posts near the viewport are mounted.
// After the reader scrolls to the bottom of a long thread, the requested post
// is gone from the page, and scrolling back up brings the first posts back
// while unmounting the last ones (issue #182). Synthetic posts only.
describe('thread-walk: scrolled down past the requested post', () => {
  const CELL = 100;
  const originalScrollTo = window.scrollTo;
  const originalScrollBy = window.scrollBy;
  let posts: string[] = [];
  let scrollY = 0;

  const post = (n: number, handle = 'alice') =>
    tweetArticle(
      String(n),
      new Date(Date.UTC(2026, 4, 1, 0, n)).toISOString(),
      `post ${n}`,
      handle,
      `<div role="group" aria-label="${n} likes"></div>`,
    );

  // Mount the posts within the viewport plus a small overscan, like X does.
  function render(): void {
    const max = posts.length * CELL - window.innerHeight;
    scrollY = Math.max(0, Math.min(scrollY, max));
    const first = Math.max(0, Math.floor(scrollY / CELL) - 2);
    const last = Math.ceil((scrollY + window.innerHeight) / CELL) + 2;
    document.querySelector('main')!.innerHTML = posts.slice(first, last).join('');
  }

  function loadScrolledToBottom(focalId: string, page: string[]): void {
    posts = page;
    document.body.innerHTML = '<main></main>';
    pointLocationAt(focalId);
    scrollY = Infinity;
    render();
  }

  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      get: () => posts.length * CELL,
      configurable: true,
    });
    window.scrollTo = ((opts?: { top?: number }) => {
      scrollY = opts?.top ?? 0;
      render();
    }) as typeof window.scrollTo;
    window.scrollBy = ((opts?: { top?: number }) => {
      scrollY += opts?.top ?? 0;
      render();
    }) as typeof window.scrollBy;
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    window.scrollBy = originalScrollBy;
    delete (window as { scrollY?: number }).scrollY;
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
  });

  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  // alice's 20-post thread, then a reply by bob and alice's answer to it.
  const thread = () => [...range(101, 120).map((n) => post(n)), post(121, 'bob'), post(122)];
  const ids = (doc: Document) =>
    doc.body.type === 'thread'
      ? (doc.body as ThreadNode).tweets.map((t) => t.tweetId)
      : [(doc.body as TweetNode).tweetId];
  const contextIds = (doc: Document) => (doc.context ?? []).map((t) => t.tweetId);
  const firstPostDate = new Date(Date.UTC(2026, 4, 1, 0, 101)).toISOString();

  it('exports the whole thread when requested at its first post', async () => {
    loadScrolledToBottom('101', thread());
    expect(document.body.textContent).not.toContain('post 101');
    const doc = (await extractTweetAsync()).body as Document;
    expect(ids(doc)).toEqual(range(101, 120).map(String));
    expect(doc.metadata.date).toBe(firstPostDate);
    expect(doc.metadata.engagement?.likes).toBe(101);
  }, 10_000);

  it('exports the whole thread from its first post when requested mid-thread', async () => {
    loadScrolledToBottom('108', thread());
    const doc = (await extractTweetAsync()).body as Document;
    expect(doc.metadata.tweetId).toBe('108');
    expect(ids(doc)).toEqual(range(101, 120).map(String));
    expect(doc.metadata.date).toBe(firstPostDate);
    expect(doc.metadata.engagement?.likes).toBe(101);
  }, 10_000);

  // A fresh mid-thread permalink shows only the posts around the requested
  // one. X loads the earlier ones after the first scroll to the top — 375 ms
  // in a real session — and keeps the requested post in view, pushing the
  // page down past them.
  it('exports the whole thread when X loads the earlier posts late', async () => {
    const earlier = range(101, 113).map((n) => post(n));
    loadScrolledToBottom('120', [...range(114, 120).map((n) => post(n)), post(121, 'bob')]);
    const scrollTo = window.scrollTo;
    let loaded = false;
    window.scrollTo = ((opts?: { top?: number }) => {
      scrollTo(opts);
      if (loaded) return;
      loaded = true;
      setTimeout(() => {
        posts = [...earlier, ...posts];
        scrollY += earlier.length * CELL;
        render();
      }, 375);
    }) as typeof window.scrollTo;
    const doc = (await extractTweetAsync()).body as Document;
    expect(ids(doc)).toEqual(range(101, 120).map(String));
    expect(doc.metadata.date).toBe(firstPostDate);
  }, 10_000);

  it('exports a reply with its context after scrolling past it', async () => {
    const page = [
      ...range(101, 105).map((n) => post(n)),
      post(106, 'bob'),
      post(107, 'bob'),
      ...range(108, 122).map((n) => post(n, 'carol')),
    ];
    loadScrolledToBottom('106', page);
    const doc = (await extractTweetAsync()).body as Document;
    expect(doc.metadata.author.handle).toBe('bob');
    expect(ids(doc)).toEqual(['106', '107']);
    expect(contextIds(doc)).toEqual(range(101, 105).map(String));
  }, 10_000);

  it('exports the requested post, not another, as a single post', async () => {
    loadScrolledToBottom('103', thread());
    const doc = (await extractTweetAsync({ singleTweet: true })).body as Document;
    expect(ids(doc)).toEqual(['103']);
    expect(doc.metadata.engagement?.likes).toBe(103);
  }, 10_000);

  for (const singleTweet of [false, true]) {
    it(`fails instead of exporting another post when the requested one never appears${singleTweet ? ' (single post)' : ''}`, async () => {
      loadScrolledToBottom('999', thread());
      const res = await extract({ singleTweet });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Couldn't find this post/);
    }, 10_000);
  }
});
