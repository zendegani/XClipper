// Applies localized strings to the popup DOM, driven by the active Chrome UI
// language. Called once on popup load. Pure DOM decoration — no app state —
// which is why it lives apart from popup.ts.

export function applyI18n(): void {
  // Chrome ships a canonical locale token per active UI language; on <html> it
  // gives the popup a correct lang for a11y and font selection.
  const uiLocale = chrome.i18n.getMessage('@@ui_locale');
  if (uiLocale) {
    document.documentElement.setAttribute('lang', uiLocale.replace(/_/g, '-'));
  }

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = chrome.i18n.getMessage(key) || el.textContent;
    }
  });

  document.querySelectorAll('[data-i18n-tooltip]').forEach((el) => {
    const key = el.getAttribute('data-i18n-tooltip');
    if (key) {
      el.setAttribute('data-tooltip', chrome.i18n.getMessage(key) || el.getAttribute('data-tooltip') || '');
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.setAttribute('placeholder', msg);
    }
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.setAttribute('aria-label', msg);
    }
  });
}
