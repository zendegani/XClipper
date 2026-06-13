// Fast Batch consent control (ADR 0003). The optional webRequest permission can
// only be granted from a user gesture, so chrome.permissions.request lives in
// this click handler — it cannot be done from the background or the console.
// Granting it lets the background observe the session auth headers and fetch the
// timeline directly (see src/background/fast-batch.ts). The current grant state
// is reflected on open; revoking in chrome://extensions returns to Standard.

const ACCESS: chrome.permissions.Permissions = {
  permissions: ['webRequest'],
  origins: ['*://x.com/*'],
};

export function initFastBatchConsent(): void {
  const btn = document.getElementById('btn-fast-batch-enable') as HTMLButtonElement | null;
  const status = document.getElementById('fast-batch-status');
  if (!btn) return;

  const render = (granted: boolean): void => {
    btn.classList.toggle('hidden', granted);
    if (status) status.textContent = granted ? '⚡ Fast Batch enabled' : '';
  };
  chrome.permissions.contains(ACCESS, render);

  btn.addEventListener('click', () => {
    chrome.permissions.request(ACCESS, (granted) => {
      void chrome.runtime.lastError; // swallow benign gesture/denial errors
      render(!!granted);
    });
  });
}
