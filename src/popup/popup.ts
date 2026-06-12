// Popup entry point. Wires the three feature modules together; the actual
// behavior lives in:
//   - i18n.ts          — localize the DOM
//   - settings-form.ts — the settings view (restore + persist + previews)
//   - actions.ts       — the four export flows
import { applyI18n } from './i18n';
import { initSettingsForm } from './settings-form';
import { initActions } from './actions';
import { initBatchUi } from './batch-ui';

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

// ─── Export mode tabs: single ↔ batch ─────────────────────────────────

const tabModeSingle = document.getElementById('tab-mode-single');
const tabModeBatch = document.getElementById('tab-mode-batch');
const panelSingle = document.getElementById('panel-single');
const panelBatch = document.getElementById('batch-section');

function setExportMode(single: boolean): void {
  tabModeSingle?.classList.toggle('active', single);
  tabModeBatch?.classList.toggle('active', !single);
  tabModeSingle?.setAttribute('aria-selected', String(single));
  tabModeBatch?.setAttribute('aria-selected', String(!single));
  panelSingle?.classList.toggle('hidden', !single);
  panelBatch?.classList.toggle('hidden', single);
}

tabModeSingle?.addEventListener('click', () => setExportMode(true));
tabModeBatch?.addEventListener('click', () => setExportMode(false));

// ─── Feature modules ──────────────────────────────────────────────────

initSettingsForm();
initActions();
void initBatchUi();
