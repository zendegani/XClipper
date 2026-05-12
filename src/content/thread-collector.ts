import type { AuthorInfo, ThreadExtractionInfo, ThreadStopReason } from '../types/messages';

export type { ThreadStopReason };

export interface ThreadTweetParts {
  text: string;
  media: string[];
}

export interface CollectedThreadTweet extends ThreadTweetParts {
  id: string;
}

export interface ThreadCollectionResult {
  author?: AuthorInfo;
  tweets: CollectedThreadTweet[];
  info: ThreadExtractionInfo;
}

export interface ThreadCollectorOptions {
  maxSteps: number;
  maxDurationMs: number;
  settleMs: number;
  mutationTimeoutMs: number;
  maxWaitMs: number;
  bottomThresholdPx: number;
}

export const DEFAULT_THREAD_COLLECTOR_OPTIONS: ThreadCollectorOptions = {
  maxSteps: 60,
  maxDurationMs: 25_000,
  settleMs: 500,
  mutationTimeoutMs: 1_250,
  maxWaitMs: 2_000,
  bottomThresholdPx: 50,
};

export interface ThreadCollectorEnv<TArticle = Element> {
  targetStatusId?: string;
  targetAuthor?: AuthorInfo;
  queryArticles(): TArticle[];
  scrollToTop(): void;
  scrollBy(amount: number): void;
  isAtBottom(thresholdPx: number): boolean;
  now(): number;
  waitForRelevantArticlesToSettle(
    deadlineAt: number,
    opts: ThreadCollectorOptions
  ): Promise<void>;
  getScrollStep(): number;
  getAuthor(article: TArticle): AuthorInfo;
  getStatusId(article: TArticle): string;
  isPromotedArticle(article: TArticle): boolean;
  extractTweet(article: TArticle): ThreadTweetParts;
}

export interface BrowserThreadCollectorDeps {
  targetStatusId?: string;
  targetAuthor?: AuthorInfo;
  getAuthor(article: Element): AuthorInfo;
  getStatusId(article: Element): string;
  extractTweet(article: Element): ThreadTweetParts;
}

function mergeOptions(
  overrides: Partial<ThreadCollectorOptions> = {}
): ThreadCollectorOptions {
  return { ...DEFAULT_THREAD_COLLECTOR_OPTIONS, ...overrides };
}

function sameHandle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function buildInfo(
  complete: boolean,
  stopReason: ThreadStopReason,
  collectedCount: number,
  failedCount: number,
  steps: number,
  durationMs: number
): ThreadExtractionInfo {
  return { complete, stopReason, collectedCount, failedCount, steps, durationMs };
}

function isTargetStatus<TArticle>(
  env: ThreadCollectorEnv<TArticle>,
  article: TArticle,
  statusId?: string
): boolean {
  if (!env.targetStatusId) return false;
  return (statusId || env.getStatusId(article)) === env.targetStatusId;
}

function shouldSkipPromoted<TArticle>(
  env: ThreadCollectorEnv<TArticle>,
  article: TArticle,
  statusId?: string
): boolean {
  return !isTargetStatus(env, article, statusId) && env.isPromotedArticle(article);
}

function seedTargetArticle<TArticle>(
  env: ThreadCollectorEnv<TArticle>,
  collected: Map<string, CollectedThreadTweet>,
  observedSameAuthorIds: Set<string>,
  failedSameAuthorIds: Set<string>
): AuthorInfo | null {
  const articles = env.queryArticles();
  const targetArticle = env.targetStatusId
    ? articles.find(
        (article) =>
          env.getStatusId(article) === env.targetStatusId
      )
    : undefined;
  const fallbackArticle =
    targetArticle ||
    (env.targetAuthor?.handle && env.targetAuthor.handle !== 'unknown'
      ? articles.find(
          (article) =>
            !shouldSkipPromoted(env, article) &&
            sameHandle(env.getAuthor(article).handle, env.targetAuthor!.handle)
        )
      : undefined);

  if (!fallbackArticle) return null;

  const statusId = env.getStatusId(fallbackArticle);
  if (!statusId) return env.getAuthor(fallbackArticle);

  observedSameAuthorIds.add(statusId);
  try {
    const parts = env.extractTweet(fallbackArticle);
    collected.set(statusId, { id: statusId, ...parts });
  } catch {
    failedSameAuthorIds.add(statusId);
  }
  return env.getAuthor(fallbackArticle);
}

// Locale-stable structural marker is the primary signal. The label set covers
// the X.com display languages the extension itself ships locales for, plus
// "Ad" — the current English label X.com renders for many promoted formats.
const PROMOTED_LABELS = new Set(
  [
    'promoted',
    'ad',
    'promoted tweet',
    '広告',
    'プロモーション',
    'プロモツイート',
    'werbung',
    'anuncio',
    'patrocinado',
    'promu',
    '广告',
    'إعلان',
    'تبلیغ',
  ].map((label) => label.toLowerCase())
);

export function isPromotedArticle(article: Element): boolean {
  if (
    article.querySelector('[data-testid="placementTracking"], [data-testid="promotedIndicator"]')
  ) {
    return true;
  }

  // Scan label nodes outside the tweet body and any embedded quote/link
  // card. Real promoted tweets still contain a tweetText element — the ad
  // label lives in a sibling header span — so we can't bail on tweetText
  // presence. We exclude nodes inside tweetText (avoid matching ad-related
  // words in normal copy) and inside role="link" (avoid matching a
  // quoted-tweet's own "Promoted" label as the outer article's).
  return Array.from(article.querySelectorAll('span, div')).some((el) => {
    if (el.closest('[data-testid="tweetText"]')) return false;
    if (el.closest('[role="link"]')) return false;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return PROMOTED_LABELS.has(text);
  });
}

export function hasRelevantArticleMutation(records: MutationRecord[]): boolean {
  return records.some((record) =>
    Array.from(record.addedNodes).some((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const el = node as Element;
      return (
        el.matches?.('article[role="article"]') ||
        !!el.querySelector?.('article[role="article"]')
      );
    })
  );
}

export async function collectThreadTweets<TArticle>(
  env: ThreadCollectorEnv<TArticle>,
  overrides: Partial<ThreadCollectorOptions> = {}
): Promise<ThreadCollectionResult> {
  const opts = mergeOptions(overrides);
  const startedAt = env.now();
  const deadlineAt = startedAt + opts.maxDurationMs;
  const collected = new Map<string, CollectedThreadTweet>();
  const observedSameAuthorIds = new Set<string>();
  const failedSameAuthorIds = new Set<string>();

  let pendingBoundary = false;
  let threadAuthor: AuthorInfo | null = null;
  let quietCycles = 0;
  let steps = 0;
  let stopReason: ThreadStopReason = 'max_steps';

  threadAuthor = seedTargetArticle(
    env,
    collected,
    observedSameAuthorIds,
    failedSameAuthorIds
  );
  env.scrollToTop();

  while (steps < opts.maxSteps) {
    steps += 1;

    if (env.now() >= deadlineAt) {
      stopReason = 'max_duration';
      break;
    }

    await env.waitForRelevantArticlesToSettle(deadlineAt, opts);

    if (env.now() >= deadlineAt) {
      stopReason = 'max_duration';
      break;
    }

    const articles = env.queryArticles();
    if (steps === 1 && articles.length === 0 && collected.size === 0) {
      stopReason = 'no_new_posts';
      break;
    }

    if (!threadAuthor && env.targetStatusId) {
      const targetArticle = articles.find(
        (article) =>
          env.getStatusId(article) === env.targetStatusId
      );
      if (targetArticle) {
        threadAuthor = env.getAuthor(targetArticle);
      }
    }
    if (!threadAuthor && env.targetAuthor?.handle && env.targetAuthor.handle !== 'unknown') {
      threadAuthor = env.targetAuthor;
    }

    const hadPendingBoundaryAtCycleStart = pendingBoundary;
    let observedSameAuthorProgress = false;
    let sawNonPromotedArticle = false;
    const sawArticle = articles.length > 0;

    for (const article of articles) {
      const statusId = env.getStatusId(article);
      if (shouldSkipPromoted(env, article, statusId)) continue;
      sawNonPromotedArticle = true;
      if (!statusId) continue;
      const articleAuthor = env.getAuthor(article);
      if (!threadAuthor && env.targetStatusId) continue;
      if (!threadAuthor) threadAuthor = articleAuthor;

      if (sameHandle(articleAuthor.handle, threadAuthor.handle)) {
        if (!observedSameAuthorIds.has(statusId)) {
          observedSameAuthorIds.add(statusId);
          observedSameAuthorProgress = true;
          pendingBoundary = false;

          try {
            const parts = env.extractTweet(article);
            collected.set(statusId, { id: statusId, ...parts });
          } catch {
            failedSameAuthorIds.add(statusId);
          }
        }
        continue;
      }

      if (observedSameAuthorIds.size > 0 && !pendingBoundary) {
        pendingBoundary = true;
      }
    }

    if (hadPendingBoundaryAtCycleStart && pendingBoundary && !observedSameAuthorProgress) {
      stopReason = 'reply_boundary';
      break;
    }

    if (!pendingBoundary && env.isAtBottom(opts.bottomThresholdPx)) {
      stopReason = 'bottom';
      break;
    }

    const quietEligible =
      !pendingBoundary &&
      !observedSameAuthorProgress &&
      (sawNonPromotedArticle || (observedSameAuthorIds.size > 0 && !sawArticle));
    const adOnly = sawArticle && !sawNonPromotedArticle;

    // Ad-only cycles are treated as absent and preserve quiet-cycle state.
    if (quietEligible) {
      quietCycles += 1;
      if (quietCycles >= 2) {
        stopReason = 'no_new_posts';
        break;
      }
    } else if (!adOnly) {
      quietCycles = 0;
    }

    if (steps >= opts.maxSteps) {
      stopReason = 'max_steps';
      break;
    }

    env.scrollBy(env.getScrollStep());
  }

  const scanComplete =
    stopReason === 'reply_boundary' ||
    stopReason === 'bottom' ||
    stopReason === 'no_new_posts';
  const complete = scanComplete && failedSameAuthorIds.size === 0;
  // Date.now() can move backwards under NTP/system-clock adjustments, so
  // clamp to keep thread_duration_ms a non-negative integer for downstream
  // YAML and HTML-comment consumers.
  const durationMs = Math.max(0, Math.round(env.now() - startedAt));

  return {
    author: threadAuthor || undefined,
    tweets: Array.from(collected.values()),
    info: buildInfo(
      complete,
      stopReason,
      collected.size,
      failedSameAuthorIds.size,
      steps,
      durationMs
    ),
  };
}

function getWaitMs(deadlineAt: number, opts: ThreadCollectorOptions): number {
  const remaining = Math.max(0, deadlineAt - Date.now());
  return Math.min(opts.maxWaitMs, remaining);
}

export function findTimelineRoot(): Element {
  const firstArticle = document.querySelector('article[role="article"]');
  const timeline =
    firstArticle?.closest('[aria-label][role="region"]') ||
    firstArticle?.closest('main') ||
    document.querySelector('main');
  // Cold starts can have no article yet; body is noisy, but mutation filtering
  // ignores non-article churn until the first article subtree is added.
  return timeline || document.body;
}

export function createBrowserThreadCollectorEnv(
  deps: BrowserThreadCollectorDeps
): ThreadCollectorEnv<Element> {
  return {
    targetStatusId: deps.targetStatusId,
    targetAuthor: deps.targetAuthor,
    queryArticles: () => Array.from(document.querySelectorAll('article[role="article"]')),
    scrollToTop: () => window.scrollTo({ top: 0, behavior: 'instant' }),
    scrollBy: (amount) => window.scrollBy({ top: amount, behavior: 'instant' }),
    isAtBottom: (thresholdPx) =>
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - thresholdPx,
    now: () => Date.now(),
    waitForRelevantArticlesToSettle: (deadlineAt, opts) =>
      waitForRelevantArticlesToSettle(findTimelineRoot(), deadlineAt, opts),
    getScrollStep: () => Math.max(window.innerHeight * 0.6, 400),
    getAuthor: deps.getAuthor,
    getStatusId: deps.getStatusId,
    isPromotedArticle,
    extractTweet: deps.extractTweet,
  };
}

export function waitForRelevantArticlesToSettle(
  root: Element,
  deadlineAt: number,
  opts: ThreadCollectorOptions
): Promise<void> {
  const maxWaitMs = getWaitMs(deadlineAt, opts);
  if (maxWaitMs <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    let settledTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    let observer: MutationObserver;

    const cleanup = () => {
      if (done) return;
      done = true;
      observer.takeRecords();
      observer.disconnect();
      if (settledTimer) clearTimeout(settledTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (maxTimer) clearTimeout(maxTimer);
      resolve();
    };

    const markRelevant = () => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (settledTimer) clearTimeout(settledTimer);
      settledTimer = setTimeout(cleanup, opts.settleMs);
    };

    observer = new MutationObserver((records) => {
      if (hasRelevantArticleMutation(records)) {
        markRelevant();
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    fallbackTimer = setTimeout(cleanup, opts.mutationTimeoutMs);
    maxTimer = setTimeout(cleanup, maxWaitMs);
  });
}
