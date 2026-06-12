// The Chrome Web Store review banner. Shown at the top of the popup once the
// user has produced enough exports (see shared/review-prompt for the counter
// and cadence). The three outcomes map to: Rate (open store + close forever),
// Maybe later (snooze once), and the × close (treated as "No thanks" — close).

import {
  loadReviewState,
  saveReviewState,
  shouldShowReview,
  snoozeReview,
  closeReview,
  REVIEW_URL,
} from '../shared/review-prompt';

export async function initReviewBanner(): Promise<void> {
  const banner = document.getElementById('review-banner');
  if (!banner) return;

  const state = await loadReviewState();
  if (!shouldShowReview(state)) return;

  banner.classList.remove('hidden');

  const dismiss = () => banner.classList.add('hidden');

  document.getElementById('review-rate')?.addEventListener('click', () => {
    saveReviewState(closeReview(state));
    chrome.tabs.create({ url: REVIEW_URL });
    dismiss();
  });

  document.getElementById('review-later')?.addEventListener('click', () => {
    saveReviewState(snoozeReview(state));
    dismiss();
  });

  document.getElementById('review-close')?.addEventListener('click', () => {
    saveReviewState(closeReview(state));
    dismiss();
  });
}
