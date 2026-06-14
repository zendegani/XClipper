// Tier-1 export mode: Single ↔ Batch. The selection is remembered across
// popup opens, and batch-ui forces Batch when it finds a job already running
// so reopening the popup mid-job lands on the progress, not on Single.

import { syncBatchControls } from './settings-form';
import { syncFastBatchMode } from './fast-batch-ui';

const MODE_KEY = 'lastExportMode';

const tabSingle = document.getElementById('tab-mode-single');
const tabBatch = document.getElementById('tab-mode-batch');
const panelSingle = document.getElementById('panel-single');
const panelBatch = document.getElementById('batch-section');
// Format + output controls only apply to batch runs, so they ride with the mode.
const batchFormatControls = document.getElementById('batch-format-controls');

export function setExportMode(single: boolean, persist = true): void {
  tabSingle?.classList.toggle('active', single);
  tabBatch?.classList.toggle('active', !single);
  tabSingle?.setAttribute('aria-selected', String(single));
  tabBatch?.setAttribute('aria-selected', String(!single));
  panelSingle?.classList.toggle('hidden', !single);
  panelBatch?.classList.toggle('hidden', single);
  batchFormatControls?.classList.toggle('hidden', single);
  // Fast Batch bar + red glow ride with the mode too (batch-only).
  syncFastBatchMode(single);
  // The format-gated toggle disabling depends on mode, so re-sync after the
  // batch controls' visibility flips.
  syncBatchControls();
  if (persist) chrome.storage.local.set({ [MODE_KEY]: single ? 'single' : 'batch' });
}

export function initModeTabs(): void {
  tabSingle?.addEventListener('click', () => setExportMode(true));
  tabBatch?.addEventListener('click', () => setExportMode(false));
  chrome.storage.local.get(MODE_KEY, (res) => {
    if (res[MODE_KEY] === 'batch') setExportMode(false, false);
  });
}
