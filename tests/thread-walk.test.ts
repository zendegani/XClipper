import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extract } from '../src/content/content';

// Build a single <article> belonging to @alice, given its id, time iso and
// tweet text. The author block matches what extractAuthorFromArticle parses.
function tweetArticle(id: string, iso: string, text: string): string {
  return `
    <article role="article" data-tid="${id}">
      <div data-testid="User-Name">
        <a href="/alice"><span>Alice</span></a>
        <a href="/alice"><span>@alice</span></a>
      </div>
      <a href="/alice/status/${id}"><time datetime="${iso}">…</time></a>
      <div data-testid="tweetText"><span>${text}</span></div>
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
