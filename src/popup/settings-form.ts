// Settings view controller: restores persisted settings into the form, wires
// every control back to storage, and owns the in-memory frontmatter-field maps
// (the one piece of settings state that doesn't live on a DOM element). The
// action flows read those maps via currentFrontmatterFields(); everything else
// here is self-contained UI behavior.

import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  SECTION_MAX_OPEN,
  type FieldMap,
  type BatchFormat,
  type BatchOutput,
} from '../shared/settings';
import {
  buildFilename,
  applyTagsTemplate,
  FRONTMATTER_FIELDS_DEFAULT,
  FRONTMATTER_FIELDS_OBSIDIAN,
  DEFAULT_TAGS_TEMPLATE,
  TAGS_PLACEHOLDERS,
  FILENAME_PLACEHOLDERS,
} from '../shared/post-process';
import { hostMatches } from '../shared/media';
import { attachPlaceholderAutocomplete } from './placeholder-autocomplete';
import { updateFloodHint } from './fast-batch-ui';
import {
  fmtButtons,
  batchFormatControls,
  batchFormatSelect,
  outSeparate,
  outBoth,
  outCombined,
  chkZip,
  zipToggle,
  saveLocalField,
  saveLocalOff,
  saveLocalImages,
  saveLocalMedia,
  chkMetadata,
  chkCloseTab,
  chkInlineCopies,
  chkShowInline,
  chkInlineStats,
  chkIncludeReposts,
  chkObsidianFriendly,
  txtObsidianVault,
  txtDownloadFolder,
  txtObsidianFolder,
  txtObsidianTags,
  txtFilenameTemplate,
  tagsPreview,
  btnTagsReset,
  tagsAutocomplete,
  tagsFieldLabel,
  filenamePreview,
  filenameAutocomplete,
} from './dom';

const t = (key: string, fallback: string): string => chrome.i18n.getMessage(key) || fallback;

// Same grant Fast Batch's Auto/Super engines ask for — one capture serves both.
const MEDIA_ACCESS: chrome.permissions.Permissions = {
  permissions: ['webRequest'],
  origins: ['*://x.com/*'],
};

async function reloadActiveXTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && hostMatches(tab.url || '', 'x.com', 'www.x.com')) {
    await chrome.tabs.reload(tab.id);
  }
}

// In-memory snapshot of field selections — the source of truth that gets
// persisted. Checkbox `checked` state mirrors whichever mode is currently
// visible; the other mode's choices live here so toggling Obsidian doesn't
// lose them.
let frontmatterFields: FieldMap = { ...DEFAULT_SETTINGS.frontmatterFields };
let frontmatterFieldsObsidian: FieldMap = { ...DEFAULT_SETTINGS.frontmatterFieldsObsidian };

// MRU list of expanded section ids. Mutated by handleSectionToggle below; read
// by persistAll. Trailing items are the most recently opened — when length
// would exceed SECTION_MAX_OPEN we evict from the head.
let settingsSectionsOpen: string[] = [...DEFAULT_SETTINGS.settingsSectionsOpen];

// The frontmatter map the extraction flow should use for the current mode.
export function currentFrontmatterFields(obsidianFriendly: boolean): FieldMap {
  return obsidianFriendly ? frontmatterFieldsObsidian : frontmatterFields;
}

// ─── Single-export format selector (md + html / json / txt / csv) ──
// The active button (aria-checked) is the source of truth read back into the
// persisted settings; the action flows read it the same way at click time.
export function readSingleFormat(): BatchFormat {
  const active = fmtButtons.find((b) => b.getAttribute('aria-checked') === 'true');
  return (active?.dataset.format as BatchFormat) || 'md';
}

export function applySingleFormat(fmt: BatchFormat): void {
  for (const b of fmtButtons) {
    b.setAttribute('aria-checked', String(b.dataset.format === fmt));
  }
}

export function persistAll(): void {
  saveSettings({
    downloadImages: readSaveLocal() !== 'off',
    saveVideos: readSaveLocal() === 'media',
    includeMetadata: chkMetadata.checked,
    closeTabAfterExport: chkCloseTab.checked,
    inlineButtonCopies: chkInlineCopies.checked,
    showInlineButton: chkShowInline.checked,
    inlineStats: chkInlineStats.checked,
    includeReposts: chkIncludeReposts.checked,
    obsidianFriendly: chkObsidianFriendly.checked,
    obsidianVault: txtObsidianVault.value.trim(),
    obsidianFolder: txtObsidianFolder.value.trim(),
    obsidianTagsTemplate: txtObsidianTags.value.trim(),
    downloadFolder: txtDownloadFolder.value.trim(),
    filenameTemplate: txtFilenameTemplate.value.trim(),
    singleFormat: readSingleFormat(),
    batchFormat: batchFormatSelect.value as BatchFormat,
    batchOutput: readBatchOutput(),
    batchZip: chkZip.checked,
    frontmatterFields,
    frontmatterFieldsObsidian,
    settingsSectionsOpen,
  });
}

// ─── Batch format + output (a <select> and a radio "segmented" group) ──

function readBatchOutput(): BatchOutput {
  if (outBoth.checked) return 'both';
  if (outCombined.checked) return 'combined';
  return 'separate';
}

function setBatchOutput(value: BatchOutput): void {
  outSeparate.checked = value === 'separate';
  outBoth.checked = value === 'both';
  outCombined.checked = value === 'combined';
}

// The Off | Images | Media control is presentation over two stored booleans,
// not a setting of its own — see Settings.saveVideos for why the pair can't
// collapse into one key. Media implies Images: the poster is an image, and one
// control beats two.
type SaveLocal = 'off' | 'images' | 'media';

function readSaveLocal(): SaveLocal {
  if (saveLocalMedia.checked) return 'media';
  if (saveLocalImages.checked) return 'images';
  return 'off';
}

// Whether to rewrite media links to local paths at all — true for both tiers,
// since Media implies Images.
export function saveLocalEnabled(): boolean {
  return readSaveLocal() !== 'off';
}

// Media is the tier that also wants the video file itself. Single export can
// only honour that once the X session is captured, which is why picking Media
// asks for the same permission the Auto/Super engines do.
export function saveLocalMediaEnabled(): boolean {
  return readSaveLocal() === 'media';
}

function setSaveLocal(value: SaveLocal): void {
  saveLocalOff.checked = value === 'off';
  saveLocalImages.checked = value === 'images';
  saveLocalMedia.checked = value === 'media';
}

// CSV is metadata-only, so a per-item CSV makes no sense — force one combined
// file and lock the other two options while CSV is selected.
function syncOutputForFormat(): void {
  const csv = batchFormatSelect.value === 'csv';
  if (csv) setBatchOutput('combined');
  outSeparate.disabled = csv;
  outBoth.disabled = csv;
}

// In Batch mode, grey out the toggles a format doesn't use, so it's clear they
// have no effect: local images apply only to Markdown; engagement stats to
// Markdown + HTML; metadata to Markdown + CSV. Single mode leaves all enabled
// (the format is chosen per-button there, not up front).
function syncBatchToggles(): void {
  const batchMode = !batchFormatControls.classList.contains('hidden');
  const fmt = batchFormatSelect.value;
  const gate = (chk: HTMLInputElement, applies: boolean): void => {
    const disabled = batchMode && !applies;
    chk.disabled = disabled;
    chk.closest('.toggle-label')?.classList.toggle('disabled', disabled);
  };
  gate(chkInlineStats, fmt === 'md' || fmt === 'html');
  gate(chkMetadata, fmt === 'md' || fmt === 'csv');
  // Same greying rule for the save-locally group, but it's a radio set in a
  // .batch-field rather than a .toggle-label, so gate() doesn't fit it.
  const saveLocalDisabled = batchMode && fmt !== 'md';
  for (const r of [saveLocalOff, saveLocalImages, saveLocalMedia]) r.disabled = saveLocalDisabled;
  saveLocalField.classList.toggle('disabled', saveLocalDisabled);
  // Zip means different things per mode, so it gates differently. In Batch it
  // packs the per-item files: meaningless with Combined-only output, and still
  // blocked while local media is on, because a thousand posts' images and
  // videos will not fit through the base64 data: URL the archive is delivered
  // as. In Single the archive is one post, so that ceiling doesn't apply and
  // pairing Zip with local media is the whole point — keep it enabled.
  const zipBlocked = batchMode && (outCombined.checked || (readSaveLocal() !== 'off' && fmt === 'md'));
  chkZip.disabled = zipBlocked;
  chkZip.closest('.toggle-label')?.classList.toggle('disabled', zipBlocked);
  zipToggle.dataset.tooltip = batchMode
    ? t('opt_zip_title_batch', 'Pack all per-post files into a single .zip — one download instead of thousands. Not available while local media saving is on, or with Combined output.')
    : t('opt_zip_title_single', 'Pack the export into a single .zip — one archive instead of a Markdown file plus a sibling media folder.');
}

// Reconcile both batch-only control groups (output radios + format-gated
// toggles) with the current format and mode. Called from mode switches,
// settings restore, and the format <select> change.
export function syncBatchControls(): void {
  syncOutputForFormat();
  syncBatchToggles();
  // The flood hint reads the zip/output state this sync just settled.
  updateFloodHint();
}

function updateInlineCopiesEnabled(): void {
  const enabled = chkShowInline.checked;
  chkInlineCopies.disabled = !enabled;
  chkInlineCopies.closest('.toggle-label')?.classList.toggle('disabled', !enabled);
}

// ─── Collapsible settings sections (LRU cap = SECTION_MAX_OPEN) ────

const sectionDetailsById = new Map<string, HTMLDetailsElement>();
document.querySelectorAll<HTMLDetailsElement>('details.option-group[data-section-id]').forEach((el) => {
  const id = el.dataset.sectionId;
  if (id) sectionDetailsById.set(id, el);
});

// Suppress the `toggle` listener while we programmatically open/close to
// reconcile state — without this flag, evicting a section would re-enter the
// listener and corrupt the MRU list.
let sectionsSyncing = false;

function syncSectionDom(): void {
  sectionsSyncing = true;
  for (const [id, el] of sectionDetailsById) {
    el.open = settingsSectionsOpen.includes(id);
  }
  sectionsSyncing = false;
}

function applySettingsSections(): void {
  reconcileSections();
  syncSectionDom();
}

// Enforce two invariants on the open-list:
//   1. Frontmatter requires Obsidian (its toggle picks which Frontmatter mode
//      is visible — orphaning Frontmatter would hide that choice).
//   2. Length ≤ SECTION_MAX_OPEN. Evict from the head (oldest), but never
//      evict Obsidian while Frontmatter is still open.
function reconcileSections(): void {
  if (settingsSectionsOpen.includes('frontmatter') && !settingsSectionsOpen.includes('obsidian')) {
    const fmIdx = settingsSectionsOpen.indexOf('frontmatter');
    settingsSectionsOpen.splice(fmIdx, 0, 'obsidian');
  }
  while (settingsSectionsOpen.length > SECTION_MAX_OPEN) {
    const fmOpen = settingsSectionsOpen.includes('frontmatter');
    const evictIdx = fmOpen && settingsSectionsOpen[0] === 'obsidian' ? 1 : 0;
    settingsSectionsOpen.splice(evictIdx, 1);
  }
}

function handleSectionToggle(id: string, opened: boolean): void {
  if (sectionsSyncing) return;
  if (opened) {
    // Move-to-end on re-open.
    settingsSectionsOpen = settingsSectionsOpen.filter((x) => x !== id);
    settingsSectionsOpen.push(id);
  } else {
    settingsSectionsOpen = settingsSectionsOpen.filter((x) => x !== id);
    // Closing Obsidian implicitly closes Frontmatter — Frontmatter can't
    // stand alone (see invariant 1 in reconcileSections).
    if (id === 'obsidian') {
      settingsSectionsOpen = settingsSectionsOpen.filter((x) => x !== 'frontmatter');
    }
  }
  reconcileSections();
  syncSectionDom();
  persistAll();
}

// ─── Frontmatter field picker ──────────────────────────────────────

const fieldCheckboxes = Array.from(
  document.querySelectorAll<HTMLInputElement>('.fm-field-input')
);

function syncFieldCheckboxes(): void {
  for (const cb of fieldCheckboxes) {
    const mode = cb.dataset.mode === 'obsidian' ? 'obsidian' : 'default';
    const field = cb.dataset.field || '';
    const map = mode === 'obsidian' ? frontmatterFieldsObsidian : frontmatterFields;
    cb.checked = map[field] !== false;
  }
}

function updateFieldPickerMode(): void {
  const obsidian = chkObsidianFriendly.checked;
  document.querySelectorAll<HTMLElement>('.fm-picker-list').forEach((list) => {
    const mode = list.dataset.mode === 'obsidian' ? 'obsidian' : 'default';
    list.hidden = (mode === 'obsidian') !== obsidian;
  });
}

// Grey out the whole picker when Include metadata is off — without
// frontmatter there's nothing to filter, and a live-looking control would
// suggest otherwise.
function updateFieldPickerEnabled(): void {
  const enabled = chkMetadata.checked;
  const picker = document.querySelector<HTMLElement>('.fm-picker');
  picker?.classList.toggle('disabled', !enabled);
  fieldCheckboxes.forEach((cb) => {
    cb.disabled = !enabled;
  });
  document.querySelectorAll<HTMLButtonElement>('.fm-picker-select-all').forEach((btn) => {
    btn.disabled = !enabled;
  });
}

// ─── Filename + tags template previews ─────────────────────────────

const PREVIEW_SAMPLE = {
  type: 'thread' as const,
  author: { name: 'Jane Doe', handle: '@janedoe' },
  markdown: '# Jane Doe (@janedoe)\n\nThe quick brown fox jumps over the lazy dog.',
  sourceUrl: 'https://x.com/janedoe/status/1234567890',
  date: '2026-05-19T14:30:00.000Z',
  tweetId: '1234567890',
};

function updateFilenamePreview(): void {
  if (!filenamePreview) return;
  const template = txtFilenameTemplate.value.trim();
  filenamePreview.textContent = buildFilename(PREVIEW_SAMPLE, template);
}

function isTagsFieldEnabledInPicker(): boolean {
  // The user can hide the tags YAML entry from the Obsidian-friendly mode via
  // the Frontmatter-fields picker. When hidden the tags template is irrelevant
  // so we mirror that state into the input.
  return frontmatterFieldsObsidian.tags !== false;
}

function updateTagsTemplateEnabled(): void {
  if (!tagsFieldLabel) return;
  const enabled = chkObsidianFriendly.checked && chkMetadata.checked && isTagsFieldEnabledInPicker();
  tagsFieldLabel.classList.toggle('disabled', !enabled);
  txtObsidianTags.disabled = !enabled;
  btnTagsReset.disabled = !enabled;
}

function updateTagsPreview(): void {
  if (!tagsPreview) return;
  const template = txtObsidianTags.value.trim() || DEFAULT_TAGS_TEMPLATE;
  const tags = applyTagsTemplate(template, PREVIEW_SAMPLE);
  tagsPreview.replaceChildren(
    ...tags.map((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = `#${t}`;
      return chip;
    })
  );
}

// Restores persisted settings into the form and wires every control back to
// storage. Call once on popup open.
export function initSettingsForm(): void {
  // Restore toggle states on popup open.
  loadSettings().then((settings) => {
    setSaveLocal(settings.downloadImages ? (settings.saveVideos ? 'media' : 'images') : 'off');
    chkMetadata.checked = settings.includeMetadata;
    chkCloseTab.checked = settings.closeTabAfterExport;
    chkInlineCopies.checked = settings.inlineButtonCopies;
    chkShowInline.checked = settings.showInlineButton;
    chkInlineStats.checked = settings.inlineStats;
    chkIncludeReposts.checked = settings.includeReposts;
    chkObsidianFriendly.checked = settings.obsidianFriendly;
    txtObsidianVault.value = settings.obsidianVault;
    txtObsidianFolder.value = settings.obsidianFolder;
    txtObsidianTags.value = settings.obsidianTagsTemplate;
    txtDownloadFolder.value = settings.downloadFolder;
    txtFilenameTemplate.value = settings.filenameTemplate;
    applySingleFormat(settings.singleFormat);
    batchFormatSelect.value = settings.batchFormat;
    setBatchOutput(settings.batchOutput);
    chkZip.checked = settings.batchZip;
    syncBatchControls();
    frontmatterFields = { ...settings.frontmatterFields };
    frontmatterFieldsObsidian = { ...settings.frontmatterFieldsObsidian };
    settingsSectionsOpen = [...settings.settingsSectionsOpen];
    applySettingsSections();
    syncFieldCheckboxes();
    updateFieldPickerMode();
    updateFieldPickerEnabled();
    updateFilenamePreview();
    updateInlineCopiesEnabled();
    updateTagsTemplateEnabled();
    updateTagsPreview();
  });

  // ─── Collapsible sections ───
  sectionDetailsById.forEach((el, id) => {
    el.addEventListener('toggle', () => handleSectionToggle(id, el.open));
  });

  // ─── Frontmatter field picker ───
  fieldCheckboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      const mode = cb.dataset.mode === 'obsidian' ? 'obsidian' : 'default';
      const field = cb.dataset.field || '';
      if (!field) return;
      const map = mode === 'obsidian' ? frontmatterFieldsObsidian : frontmatterFields;
      map[field] = cb.checked;
      if (mode === 'obsidian' && field === 'tags') updateTagsTemplateEnabled();
      persistAll();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.fm-picker-select-all').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode === 'obsidian' ? 'obsidian' : 'default';
      const keys = mode === 'obsidian' ? FRONTMATTER_FIELDS_OBSIDIAN : FRONTMATTER_FIELDS_DEFAULT;
      const map = mode === 'obsidian' ? frontmatterFieldsObsidian : frontmatterFields;
      for (const key of keys) map[key] = true;
      syncFieldCheckboxes();
      if (mode === 'obsidian') updateTagsTemplateEnabled();
      persistAll();
    });
  });

  // ─── Tags template: preview, autocomplete (`{` opens, filters as typed) ───
  const tagsAutocompleteWidget = attachPlaceholderAutocomplete({
    input: txtObsidianTags,
    popover: tagsAutocomplete,
    placeholders: TAGS_PLACEHOLDERS,
    onSelect: () => {
      updateTagsPreview();
      persistAll();
    },
  });

  txtObsidianTags.addEventListener('input', () => {
    updateTagsPreview();
    tagsAutocompleteWidget.handleInput();
  });
  txtObsidianTags.addEventListener('change', persistAll);
  txtObsidianTags.addEventListener('blur', () => {
    // Delay just enough to let an autocomplete click register before the popover
    // is forced shut by the blur.
    setTimeout(() => {
      tagsAutocompleteWidget.close();
      persistAll();
    }, 120);
  });

  btnTagsReset.addEventListener('click', (e) => {
    e.preventDefault();
    txtObsidianTags.value = '';
    updateTagsPreview();
    tagsAutocompleteWidget.close();
    persistAll();
  });

  // ─── Plain change/blur persistence for the remaining controls ───
  // Local images and the output radios gate the zip toggle (and the flood
  // hint), so they re-sync the batch controls, not just persist.
  [saveLocalOff, saveLocalImages, saveLocalMedia].forEach((r) =>
    r.addEventListener('change', () => {
      syncBatchControls();
      persistAll();
    })
  );
  // Saving the video file needs X's own GraphQL payload — the DOM only carries
  // the poster. Ask for the same optional permission the Auto/Super engines
  // use, from the click itself because chrome.permissions.request needs the
  // gesture. Declining is fine: Media still saves images, video stays a link.
  saveLocalMedia.addEventListener('click', () => {
    chrome.permissions.contains(MEDIA_ACCESS, (has) => {
      if (has) return;
      chrome.permissions.request(MEDIA_ACCESS, (granted) => {
        void chrome.runtime.lastError; // benign gesture/denial errors
        // The capture listener only arms once the permission lands, and the
        // page fetched its TweetDetail long before that — so without a reload
        // there is no request template to replay and the first export after
        // granting would quietly fall back to the thumbnail. Reload the post
        // so the very next export has what it needs.
        if (granted) void reloadActiveXTab();
      });
    });
  });
  chkZip.addEventListener('change', () => {
    updateFloodHint();
    persistAll();
  });
  batchFormatSelect.addEventListener('change', () => {
    syncBatchControls();
    persistAll();
  });
  [outSeparate, outBoth, outCombined].forEach((r) =>
    r.addEventListener('change', () => {
      syncBatchControls();
      persistAll();
    })
  );
  chkMetadata.addEventListener('change', () => {
    // Mirror of the Obsidian-friendly → metadata rule: if metadata goes off,
    // Obsidian-friendly has nothing to reshape, so flip it off too.
    if (!chkMetadata.checked && chkObsidianFriendly.checked) {
      chkObsidianFriendly.checked = false;
      updateFieldPickerMode();
    }
    updateFieldPickerEnabled();
    updateTagsTemplateEnabled();
    persistAll();
  });
  chkCloseTab.addEventListener('change', persistAll);
  chkInlineCopies.addEventListener('change', persistAll);
  chkShowInline.addEventListener('change', () => {
    updateInlineCopiesEnabled();
    persistAll();
  });
  chkInlineStats.addEventListener('change', persistAll);
  chkIncludeReposts.addEventListener('change', persistAll);
  chkObsidianFriendly.addEventListener('change', () => {
    // Obsidian-friendly only reshapes the frontmatter — turning it on while
    // Include metadata is off would leave nothing to reshape. Flip metadata on
    // alongside so the toggle does the obviously-intended thing.
    if (chkObsidianFriendly.checked && !chkMetadata.checked) {
      chkMetadata.checked = true;
      updateFieldPickerEnabled();
    }
    updateFieldPickerMode();
    updateTagsTemplateEnabled();
    persistAll();
  });
  txtObsidianVault.addEventListener('change', persistAll);
  txtObsidianVault.addEventListener('blur', persistAll);
  txtDownloadFolder.addEventListener('change', persistAll);
  txtDownloadFolder.addEventListener('blur', persistAll);
  txtObsidianFolder.addEventListener('change', persistAll);
  txtObsidianFolder.addEventListener('blur', persistAll);
  // ─── Filename template: preview, autocomplete (`{` opens, filters as typed) ───
  const filenameAutocompleteWidget = attachPlaceholderAutocomplete({
    input: txtFilenameTemplate,
    popover: filenameAutocomplete,
    placeholders: FILENAME_PLACEHOLDERS,
    onSelect: () => {
      updateFilenamePreview();
      persistAll();
    },
  });

  txtFilenameTemplate.addEventListener('input', () => {
    updateFilenamePreview();
    filenameAutocompleteWidget.handleInput();
  });
  txtFilenameTemplate.addEventListener('change', persistAll);
  txtFilenameTemplate.addEventListener('blur', () => {
    // Delay just enough to let an autocomplete click register before the popover
    // is forced shut by the blur.
    setTimeout(() => {
      filenameAutocompleteWidget.close();
      persistAll();
    }, 120);
  });

  // ─── ⓘ placeholder-list popovers (filename template, Obsidian tags) ───
  // Show the popover only while the cursor / keyboard focus is literally on the
  // ⓘ button. CSS `:hover` could leak via wrap/label sizing; explicit listeners
  // keep the trigger surface limited to the icon. Click is a no-op so the
  // surrounding `<label>` doesn't react.
  document.querySelectorAll<HTMLButtonElement>('button.field-info').forEach((btn) => {
    const hint = btn.nextElementSibling;
    if (!(hint instanceof HTMLElement) || !hint.classList.contains('field-hint')) return;
    const show = (): void => { hint.setAttribute('data-show', 'true'); };
    const hide = (): void => { hint.removeAttribute('data-show'); };
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', show);
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', (e) => e.preventDefault());
  });
}
