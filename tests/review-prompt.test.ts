import { describe, it, expect } from 'vitest';
import {
  shouldShowReview,
  snoozeReview,
  closeReview,
  DEFAULT_REVIEW_STATE,
  REVIEW_THRESHOLD,
  REVIEW_SNOOZE_GAP,
  type ReviewState,
} from '../src/shared/review-prompt';

const at = (count: number, over: Partial<ReviewState> = {}): ReviewState => ({
  ...DEFAULT_REVIEW_STATE,
  count,
  ...over,
});

describe('shouldShowReview', () => {
  it('stays hidden below the threshold', () => {
    expect(shouldShowReview(at(REVIEW_THRESHOLD - 1))).toBe(false);
  });

  it('shows at the threshold when unseen', () => {
    expect(shouldShowReview(at(REVIEW_THRESHOLD))).toBe(true);
  });

  it('never shows once closed', () => {
    expect(shouldShowReview(at(999, { status: 'closed' }))).toBe(false);
  });

  it('while snoozed, waits for nextAt', () => {
    const s = at(40, { status: 'snoozed', nextAt: 80 });
    expect(shouldShowReview(s)).toBe(false);
    expect(shouldShowReview({ ...s, count: 80 })).toBe(true);
  });
});

describe('cadence: re-arm once on "Maybe later"', () => {
  it('first "later" snoozes by SNOOZE_GAP, second closes', () => {
    const shown = at(REVIEW_THRESHOLD);

    const snoozed = snoozeReview(shown);
    expect(snoozed.status).toBe('snoozed');
    expect(snoozed.nextAt).toBe(REVIEW_THRESHOLD + REVIEW_SNOOZE_GAP);

    // Reaches the snooze threshold and is shown again…
    const shownAgain = { ...snoozed, count: snoozed.nextAt };
    expect(shouldShowReview(shownAgain)).toBe(true);

    // …a second "later" gives up and closes for good.
    const second = snoozeReview(shownAgain);
    expect(second.status).toBe('closed');
    expect(shouldShowReview(second)).toBe(false);
  });

  it('"Rate" / "No thanks" close immediately', () => {
    expect(closeReview(at(REVIEW_THRESHOLD)).status).toBe('closed');
  });
});
