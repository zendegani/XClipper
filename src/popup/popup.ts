// Popup entry point. Wires the three feature modules together; the actual
// behavior lives in:
//   - i18n.ts          — localize the DOM
//   - settings-form.ts — the settings view (restore + persist + previews)
//   - actions.ts       — the four export flows
import { applyI18n } from './i18n';
import { initSettingsForm } from './settings-form';
import { initActions } from './actions';
import { initBatchUi } from './batch-ui';
import { initModeTabs } from './mode';
import { initReviewBanner } from './review-banner';
import { initFastBatchUi } from './fast-batch-ui';

// ─── Footer version ───────────────────────────────────────────────────

const footerVersion = document.getElementById('footer-version');
if (footerVersion) {
  footerVersion.textContent = `v${chrome.runtime.getManifest().version}`;
}

// ─── Initialize i18n ──────────────────────────────────────────────────

applyI18n();

// ─── View switching: main ↔ settings ──────────────────────────────────

const viewMain = document.getElementById('view-main');
const viewSettings = document.getElementById('view-settings');
const btnSettings = document.getElementById('btn-settings');
const btnBack = document.getElementById('btn-back');

btnSettings?.addEventListener('click', () => {
  viewMain?.classList.add('hidden');
  viewSettings?.classList.remove('hidden');
  btnSettings?.classList.add('hidden');
});
btnBack?.addEventListener('click', () => {
  viewSettings?.classList.add('hidden');
  viewMain?.classList.remove('hidden');
  btnSettings?.classList.remove('hidden');
});

// ─── Collapsible "More formats" row ───────────────────────────────────
// The native <details> handles expand/collapse; we only remember the state
// across popup opens. Defaults to open — only an explicit collapse sticks.

const FORMATS_KEY = 'formatsExpanded';
const formatDetails = document.getElementById('format-details') as HTMLDetailsElement | null;
if (formatDetails) {
  chrome.storage.local.get(FORMATS_KEY, (res) => {
    if (res[FORMATS_KEY] === false) formatDetails.open = false;
  });
  formatDetails.addEventListener('toggle', () => {
    chrome.storage.local.set({ [FORMATS_KEY]: formatDetails.open });
  });
}

// ─── Feature modules ──────────────────────────────────────────────────

initFastBatchUi();
initModeTabs();
initSettingsForm();
initActions();
void initBatchUi();
void initReviewBanner();

// ─── Toolbar-icon theme oracle ────────────────────────────────────────
// The popup is a real rendered page, so its prefers-color-scheme is
// authoritative. Report it to the background (which swaps the toolbar icon)
// whenever the popup opens — this corrects the icon even in cases the offscreen
// watcher may miss.
const themeMedia = matchMedia('(prefers-color-scheme: dark)');
const reportTheme = () => {
  void chrome.runtime.sendMessage({ action: 'XCLIPPER_THEME', dark: themeMedia.matches }).catch(() => {});
};
themeMedia.addEventListener('change', reportTheme);
reportTheme();
