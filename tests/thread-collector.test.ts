import { describe, expect, it, vi } from 'vitest';
import {
  collectThreadTweets,
  DEFAULT_THREAD_COLLECTOR_OPTIONS,
  hasRelevantArticleMutation,
  isPromotedArticle,
  type ThreadCollectorEnv,
  waitForRelevantArticlesToSettle,
} from '../src/content/thread-collector';

function element(html: string): Element {
  const root = document.createElement('div');
  root.innerHTML = html.trim();
  return root.firstElementChild as Element;
}

function childListRecord(addedNodes: Node[]): MutationRecord {
  return {
    type: 'childList',
    target: document.body,
    addedNodes: addedNodes as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  } as MutationRecord;
}

interface FakeArticle {
  id: string;
  handle: string;
  promoted?: boolean;
  fail?: boolean;
}

function fakeEnv(
  cycles: FakeArticle[][],
  opts: {
    bottomAtCycle?: number;
    nowStepMs?: number;
    targetStatusId?: string;
    targetAuthor?: { name: string; handle: string };
    scrollToTopCycle?: number;
  } = {}
): ThreadCollectorEnv<FakeArticle> & { scrolls: number[] } {
  let cycle = 0;
  let now = 0;
  const scrolls: number[] = [];
  const nowStepMs = opts.nowStepMs ?? 100;

  return {
    scrolls,
    targetStatusId: opts.targetStatusId,
    targetAuthor: opts.targetAuthor,
    queryArticles: () => cycles[Math.min(cycle, cycles.length - 1)] || [],
    scrollToTop: () => {
      if (opts.scrollToTopCycle !== undefined) {
        cycle = opts.scrollToTopCycle;
      }
    },
    scrollBy: (amount) => {
      scrolls.push(amount);
      cycle += 1;
    },
    isAtBottom: () => opts.bottomAtCycle !== undefined && cycle >= opts.bottomAtCycle,
    now: () => now,
    waitForRelevantArticlesToSettle: async () => {
      now += nowStepMs;
    },
    getScrollStep: () => 400,
    getAuthor: (article) => ({ name: article.handle.slice(1), handle: article.handle }),
    getStatusId: (article) => article.id,
    isPromotedArticle: (article) => article.promoted === true,
    extractTweet: (article) => {
      if (article.fail) throw new Error(`failed ${article.id}`);
      return { text: `tweet ${article.id}`, media: [] };
    },
  };
}

describe('thread collector helpers', () => {
  it('detects relevant article mutations only from added article elements', () => {
    const article = element('<article role="article"><div>tweet</div></article>');
    const wrapper = element('<div><article role="article"><div>tweet</div></article></div>');
    const counter = document.createTextNode('5 likes');

    expect(hasRelevantArticleMutation([childListRecord([article])])).toBe(true);
    expect(hasRelevantArticleMutation([childListRecord([wrapper])])).toBe(true);
    expect(hasRelevantArticleMutation([childListRecord([counter])])).toBe(false);
  });

  it('treats promoted articles as state-neutral skips', () => {
    const promotedByMarker = element(
      '<article role="article"><div data-testid="placementTracking"></div><span>Promoted</span></article>'
    );
    const promotedByLabel = element(
      '<article role="article"><div><span>Promoted</span></div></article>'
    );
    const normal = element('<article role="article"><div data-testid="tweetText">hello</div></article>');
    const normalWithNestedPromotedText = element(
      '<article role="article"><div data-testid="tweetText">hello</div><div role="link"><span>Promoted</span></div></article>'
    );

    expect(isPromotedArticle(promotedByMarker)).toBe(true);
    expect(isPromotedArticle(promotedByLabel)).toBe(true);
    expect(isPromotedArticle(normal)).toBe(false);
    expect(isPromotedArticle(normalWithNestedPromotedText)).toBe(false);
  });

  it('matches the modern bare "Ad" label and localized variants', () => {
    const adLabel = element('<article role="article"><div><span>Ad</span></div></article>');
    const werbung = element('<article role="article"><div><span>Werbung</span></div></article>');
    const patrocinado = element('<article role="article"><div><span>Patrocinado</span></div></article>');
    const japanese = element('<article role="article"><div><span>広告</span></div></article>');
    const chineseSimplified = element('<article role="article"><div><span>广告</span></div></article>');
    const unrelatedForeign = element('<article role="article"><div><span>Hola</span></div></article>');
    const tweetContainingAdWord = element(
      '<article role="article"><div data-testid="tweetText">had a bad ad day</div></article>'
    );

    expect(isPromotedArticle(adLabel)).toBe(true);
    expect(isPromotedArticle(werbung)).toBe(true);
    expect(isPromotedArticle(patrocinado)).toBe(true);
    expect(isPromotedArticle(japanese)).toBe(true);
    expect(isPromotedArticle(chineseSimplified)).toBe(true);
    expect(isPromotedArticle(unrelatedForeign)).toBe(false);
    expect(isPromotedArticle(tweetContainingAdWord)).toBe(false);
  });

  it('matches a promoted tweet that has both a body and an ad label', () => {
    // Real-world shape: an ad without `placementTracking` but with the
    // visible "Ad" / "Promoted" label sitting in the header next to the
    // username, alongside a tweetText body containing the ad copy.
    const promotedWithBody = element(
      '<article role="article">' +
        '<div><span>Brand</span><span>Ad</span></div>' +
        '<div data-testid="tweetText">Buy our product</div>' +
      '</article>'
    );
    const promotedWithBodyLocalized = element(
      '<article role="article">' +
        '<div><span>Marke</span><span>Werbung</span></div>' +
        '<div data-testid="tweetText">Kauf unser Produkt</div>' +
      '</article>'
    );

    expect(isPromotedArticle(promotedWithBody)).toBe(true);
    expect(isPromotedArticle(promotedWithBodyLocalized)).toBe(true);
  });
});

// If fake timers become flaky with a future JSDOM/Vitest upgrade, keep the
// assertions but switch these wait-helper tests to real timers with small
// deadlines. MutationObserver delivery is microtask-based in JSDOM.
describe('waitForRelevantArticlesToSettle()', () => {
  it('resolves at mutationTimeoutMs when no relevant article mutation arrives', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);

    try {
      const promise = waitForRelevantArticlesToSettle(
        root,
        Date.now() + 10_000,
        {
          ...DEFAULT_THREAD_COLLECTOR_OPTIONS,
          settleMs: 500,
          mutationTimeoutMs: 100,
          maxWaitMs: 2_000,
        }
      );

      root.appendChild(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(99);

      let resolved = false;
      promise.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      root.remove();
      vi.useRealTimers();
    }
  });

  it('resolves at maxWaitMs even if relevant article mutations keep arriving', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);

    try {
      const promise = waitForRelevantArticlesToSettle(
        root,
        Date.now() + 10_000,
        {
          ...DEFAULT_THREAD_COLLECTOR_OPTIONS,
          settleMs: 500,
          mutationTimeoutMs: 1_000,
          maxWaitMs: 200,
        }
      );

      root.appendChild(element('<article role="article"><div>one</div></article>'));
      await vi.advanceTimersByTimeAsync(75);
      root.appendChild(element('<article role="article"><div>two</div></article>'));
      await vi.advanceTimersByTimeAsync(75);
      root.appendChild(element('<article role="article"><div>three</div></article>'));
      await vi.advanceTimersByTimeAsync(200);

      await expect(promise).resolves.toBeUndefined();
    } finally {
      root.remove();
      vi.useRealTimers();
    }
  });
});

describe('collectThreadTweets()', () => {
  it('dedupes same-author tweets and completes at a confirmed reply boundary', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: '1', handle: '@example' }, { id: '2', handle: '@example' }],
      [{ id: '2', handle: '@example' }, { id: 'reply', handle: '@other' }],
      [{ id: 'reply', handle: '@other' }],
    ]);

    const result = await collectThreadTweets(env);

    expect(result.author?.handle).toBe('@example');
    expect(result.tweets.map((t) => t.id)).toEqual(['1', '2']);
    expect(result.info).toMatchObject({
      complete: true,
      stopReason: 'reply_boundary',
      collectedCount: 2,
      failedCount: 0,
    });
  });

  it('anchors the thread author to the target status when a reply appears first', async () => {
    const env = fakeEnv(
      [
        [
          { id: 'reply', handle: '@reply' },
          { id: 'root', handle: '@example' },
        ],
        [{ id: 'reply', handle: '@reply' }],
      ],
      { targetStatusId: 'root' }
    );

    const result = await collectThreadTweets(env);

    expect(result.author?.handle).toBe('@example');
    expect(result.tweets.map((t) => t.id)).toEqual(['root']);
    expect(result.info.stopReason).toBe('reply_boundary');
  });

  it('does not skip the target status even when it matches promoted heuristics', async () => {
    const env = fakeEnv(
      [
        [
          { id: 'root', handle: '@example', promoted: true },
          { id: 'reply', handle: '@reply' },
        ],
        [{ id: 'reply', handle: '@reply' }],
      ],
      { targetStatusId: 'root' }
    );

    const result = await collectThreadTweets(env);

    expect(result.author?.handle).toBe('@example');
    expect(result.tweets.map((t) => t.id)).toEqual(['root']);
    expect(result.info.stopReason).toBe('reply_boundary');
  });

  it('falls back to the focused page author when the target status id is unavailable', async () => {
    const env = fakeEnv(
      [
        [
          { id: 'reply', handle: '@reply' },
          { id: 'root-dom-fallback-id', handle: '@example' },
        ],
        [{ id: 'reply', handle: '@reply' }],
      ],
      {
        targetStatusId: 'root-from-url',
        targetAuthor: { name: 'Example', handle: '@example' },
      }
    );

    const result = await collectThreadTweets(env);

    expect(result.author?.handle).toBe('@example');
    expect(result.tweets.map((t) => t.id)).toEqual(['root-dom-fallback-id']);
    expect(result.info.stopReason).toBe('reply_boundary');
  });

  it('keeps a pre-scroll target tweet when scrolling temporarily unmounts articles', async () => {
    const env = fakeEnv(
      [
        [{ id: 'root', handle: '@example' }],
        [],
        [],
      ],
      {
        targetStatusId: 'root',
        scrollToTopCycle: 1,
      }
    );

    const result = await collectThreadTweets(env, { maxSteps: 4 });

    expect(result.author?.handle).toBe('@example');
    expect(result.tweets.map((t) => t.id)).toEqual(['root']);
    expect(result.info.stopReason).toBe('no_new_posts');
    expect(result.info.complete).toBe(true);
  });

  it('does not re-extract the target when it reappears after a transient unmount', async () => {
    const baseEnv = fakeEnv(
      [
        [{ id: 'root', handle: '@example' }],
        [],
        [{ id: 'root', handle: '@example' }],
        [{ id: 'root', handle: '@example' }],
      ],
      {
        targetStatusId: 'root',
        scrollToTopCycle: 1,
      }
    );
    const extractCalls: string[] = [];
    const env: typeof baseEnv = {
      ...baseEnv,
      extractTweet: (article) => {
        extractCalls.push(article.id);
        return baseEnv.extractTweet(article);
      },
    };

    const result = await collectThreadTweets(env, { maxSteps: 5 });

    expect(result.tweets.map((t) => t.id)).toEqual(['root']);
    expect(extractCalls).toEqual(['root']);
    expect(result.info.stopReason).toBe('no_new_posts');
    expect(result.info.complete).toBe(true);
  });

  it('clears a pending boundary when a later same-author tweet appears', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: 'other', handle: '@other' }],
      [{ id: '2', handle: '@example' }],
      [{ id: 'other2', handle: '@other' }],
      [{ id: 'other2', handle: '@other' }],
    ]);

    const result = await collectThreadTweets(env);

    expect(result.tweets.map((t) => t.id)).toEqual(['1', '2']);
    expect(result.info.stopReason).toBe('reply_boundary');
    expect(result.info.complete).toBe(true);
  });

  it('clears a pending boundary for a same-author tweet even when extraction fails', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: 'other', handle: '@other' }],
      [{ id: '2', handle: '@example', fail: true }],
      [{ id: 'other2', handle: '@other' }],
      [{ id: 'other2', handle: '@other' }],
    ]);

    const result = await collectThreadTweets(env);

    expect(result.tweets.map((t) => t.id)).toEqual(['1']);
    expect(result.info.failedCount).toBe(1);
    expect(result.info.stopReason).toBe('reply_boundary');
    expect(result.info.complete).toBe(false);
  });

  it('treats promoted articles as absent from progress and boundary state', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: 'ad', handle: '@brand', promoted: true }],
      [{ id: 'ad2', handle: '@brand', promoted: true }],
      [{ id: '2', handle: '@example' }],
      [{ id: 'other', handle: '@other' }],
      [{ id: 'other', handle: '@other' }],
    ]);

    const result = await collectThreadTweets(env);

    expect(result.tweets.map((t) => t.id)).toEqual(['1', '2']);
    expect(result.info.stopReason).toBe('reply_boundary');
  });

  it('does not reset quiet-cycle state for ad-only scans', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [],
      [{ id: 'ad', handle: '@brand', promoted: true }],
      [],
    ]);

    const result = await collectThreadTweets(env, { maxSteps: 5 });

    expect(result.tweets.map((t) => t.id)).toEqual(['1']);
    expect(result.info.stopReason).toBe('no_new_posts');
    expect(result.info.complete).toBe(true);
  });

  it('distinguishes bottom from no_new_posts', async () => {
    const bottomEnv = fakeEnv(
      [
        [{ id: '1', handle: '@example' }],
        [{ id: '1', handle: '@example' }],
      ],
      { bottomAtCycle: 1 }
    );

    const bottom = await collectThreadTweets(bottomEnv);
    expect(bottom.info.stopReason).toBe('bottom');

    const quietEnv = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: '1', handle: '@example' }],
      [{ id: '1', handle: '@example' }],
    ]);

    const quiet = await collectThreadTweets(quietEnv, { maxSteps: 4 });
    expect(quiet.info.stopReason).toBe('no_new_posts');
  });

  it('counts empty scans after a collected tweet toward no_new_posts', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [],
      [],
    ]);

    const result = await collectThreadTweets(env, { maxSteps: 5 });

    expect(result.tweets.map((t) => t.id)).toEqual(['1']);
    expect(result.info.stopReason).toBe('no_new_posts');
    expect(result.info.complete).toBe(true);
  });

  it('clamps durationMs to non-negative when the clock moves backwards', async () => {
    const env = fakeEnv(
      [
        [{ id: '1', handle: '@example' }],
        [{ id: '1', handle: '@example' }],
      ],
      { nowStepMs: -500 }
    );

    const result = await collectThreadTweets(env, { maxSteps: 3 });

    expect(result.info.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks max_steps and max_duration incomplete', async () => {
    const stepsEnv = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: '2', handle: '@example' }],
      [{ id: '3', handle: '@example' }],
    ]);

    const steps = await collectThreadTweets(stepsEnv, { maxSteps: 2 });
    expect(steps.info.stopReason).toBe('max_steps');
    expect(steps.info.complete).toBe(false);

    const durationEnv = fakeEnv(
      [
        [{ id: '1', handle: '@example' }],
        [{ id: '2', handle: '@example' }],
      ],
      { nowStepMs: 30_000 }
    );

    const duration = await collectThreadTweets(durationEnv, { maxDurationMs: 1 });
    expect(duration.info.stopReason).toBe('max_duration');
    expect(duration.info.complete).toBe(false);
  });

  it('keeps incomplete diagnostics for a one-post collection', async () => {
    const env = fakeEnv([
      [{ id: '1', handle: '@example' }],
      [{ id: '2', handle: '@example' }],
    ]);

    const result = await collectThreadTweets(env, { maxSteps: 1 });

    expect(result.tweets.map((t) => t.id)).toEqual(['1']);
    expect(result.info.stopReason).toBe('max_steps');
    expect(result.info.complete).toBe(false);
  });

  it('stops after the first settled scan when no articles render', async () => {
    const env = fakeEnv([[], [], []], { nowStepMs: 100 });

    const result = await collectThreadTweets(env, { maxDurationMs: 25_000 });

    expect(result.tweets).toEqual([]);
    expect(result.info.stopReason).toBe('no_new_posts');
    expect(result.info.steps).toBe(1);
    expect(env.scrolls).toEqual([]);
  });
});
