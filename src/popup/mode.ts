// Tier-1 export mode: Single ↔ Batch. The selection is remembered across
// popup opens, and batch-ui forces Batch when it finds a job already running
// so reopening the popup mid-job lands on the progress, not on Single.

const MODE_KEY = 'lastExportMode';

const tabSingle = document.getElementById('tab-mode-single');
const tabBatch = document.getElementById('tab-mode-batch');
const panelSingle = document.getElementById('panel-single');
const panelBatch = document.getElementById('batch-section');
// "Export also as one file" only applies to batch runs, so it rides with the mode.
const optBatchDigest = document.getElementById('opt-batch-digest');

export function setExportMode(single: boolean, persist = true): void {
  tabSingle?.classList.toggle('active', single);
  tabBatch?.classList.toggle('active', !single);
  tabSingle?.setAttribute('aria-selected', String(single));
  tabBatch?.setAttribute('aria-selected', String(!single));
  panelSingle?.classList.toggle('hidden', !single);
  panelBatch?.classList.toggle('hidden', single);
  optBatchDigest?.classList.toggle('hidden', single);
  if (persist) chrome.storage.local.set({ [MODE_KEY]: single ? 'single' : 'batch' });
}

export function initModeTabs(): void {
  tabSingle?.addEventListener('click', () => setExportMode(true));
  tabBatch?.addEventListener('click', () => setExportMode(false));
  chrome.storage.local.get(MODE_KEY, (res) => {
    if (res[MODE_KEY] === 'batch') setExportMode(false, false);
  });
}
