// Review-ask state. After a user has produced a number of exports (files, not
// Copy-to-clipboard), the popup shows a one-time, dismissible banner asking for
// a Chrome Web Store review. The counter lives in chrome.storage.local so every
// surface (popup, inline button, context menu, batch) can add to it; the banner
// itself only ever appears in the popup.
//
// Cadence (see issue: "ask after N exports"): first ask at THRESHOLD. "Rate" or
// "No thanks" closes it forever; "Maybe later" re-arms exactly once, SNOOZE_GAP
// exports later, after which any dismissal closes it. We never nag in a loop.

export const REVIEW_KEY = 'xclipper_review';
export const REVIEW_THRESHOLD = 30;
export const REVIEW_SNOOZE_GAP = 50;
export const REVIEW_URL =
  'https://chromewebstore.google.com/detail/xclipper/epmmehilhbpkgcjbcohgkmihlalagkho/reviews';

export interface ReviewState {
  // Qualifying exports so far.
  count: number;
  // 'unseen' → never shown; 'snoozed' → "Maybe later" once used; 'closed' →
  // terminal, never show again.
  status: 'unseen' | 'snoozed' | 'closed';
  // While snoozed, the count at which to show again.
  nextAt: number;
}

export const DEFAULT_REVIEW_STATE: ReviewState = {
  count: 0,
  status: 'unseen',
  nextAt: REVIEW_THRESHOLD,
};

export function loadReviewState(): Promise<ReviewState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(REVIEW_KEY, (result) => {
      const saved = (result[REVIEW_KEY] || {}) as Partial<ReviewState>;
      resolve({ ...DEFAULT_REVIEW_STATE, ...saved });
    });
  });
}

export function saveReviewState(state: ReviewState): void {
  chrome.storage.local.set({ [REVIEW_KEY]: state });
}

// Count one qualifying export. No-op once the prompt is closed (nothing left to
// trigger). Fire-and-forget from the various export success paths.
export async function recordExport(): Promise<void> {
  const state = await loadReviewState();
  if (state.status === 'closed') return;
  saveReviewState({ ...state, count: state.count + 1 });
}

// Pure predicate so it can be unit-tested without storage.
export function shouldShowReview(state: ReviewState): boolean {
  if (state.status === 'closed') return false;
  if (state.status === 'snoozed') return state.count >= state.nextAt;
  return state.count >= REVIEW_THRESHOLD;
}

// "Maybe later": re-arm once, then close on the next dismissal.
export function snoozeReview(state: ReviewState): ReviewState {
  if (state.status === 'snoozed') return { ...state, status: 'closed' };
  return { ...state, status: 'snoozed', nextAt: state.count + REVIEW_SNOOZE_GAP };
}

// "Rate" or "No thanks": never show again.
export function closeReview(state: ReviewState): ReviewState {
  return { ...state, status: 'closed' };
}
