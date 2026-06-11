// Applies localized strings + bidi direction to the popup DOM, driven by the
// active Chrome UI language. Called once on popup load. Pure DOM decoration —
// no app state — which is why it lives apart from popup.ts.

export function applyI18n(): void {
  // Chrome ships canonical direction + locale tokens per active UI language.
  // Setting them on <html> is what makes bidi text (e.g. Latin words embedded
  // in Arabic/Persian sentences) flow correctly and lets logical CSS props
  // (inset-inline-*, margin-inline-*) mirror the layout for RTL locales.
  const bidiDir = chrome.i18n.getMessage('@@bidi_dir');
  if (bidiDir === 'rtl' || bidiDir === 'ltr') {
    document.documentElement.setAttribute('dir', bidiDir);
  }
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
