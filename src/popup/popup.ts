import type { ExtractResponse, DownloadRequest } from '../types/messages';
import {
  postProcess,
  resolveDownloadImages,
  buildFilename,
  applyTagsTemplate,
  FRONTMATTER_FIELDS_DEFAULT,
  FRONTMATTER_FIELDS_OBSIDIAN,
  DEFAULT_TAGS_TEMPLATE,
  TAGS_PLACEHOLDERS,
  type PostProcessResult,
} from '../shared/post-process';
import { buildObsidianUrl } from '../shared/obsidian';
import { hostMatches } from '../shared/media';

const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const btnPdf = document.getElementById('btn-pdf') as HTMLButtonElement;
const btnObsidian = document.getElementById('btn-obsidian') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const chkDownloadImages = document.getElementById(
  'chk-download-images'
) as HTMLInputElement;
const chkMetadata = document.getElementById(
  'chk-include-metadata'
) as HTMLInputElement;
const chkCloseTab = document.getElementById(
  'chk-close-tab'
) as HTMLInputElement;
const chkInlineCopies = document.getElementById(
  'chk-inline-copies'
) as HTMLInputElement;
const chkShowInline = document.getElementById(
  'chk-show-inline'
) as HTMLInputElement;
const chkInlineStats = document.getElementById(
  'chk-inline-stats'
) as HTMLInputElement;
const chkObsidianFriendly = document.getElementById(
  'chk-obsidian-friendly'
) as HTMLInputElement;
const txtObsidianVault = document.getElementById(
  'txt-obsidian-vault'
) as HTMLInputElement;
const txtDownloadFolder = document.getElementById(
  'txt-download-folder'
) as HTMLInputElement;
const txtObsidianFolder = document.getElementById(
  'txt-obsidian-folder'
) as HTMLInputElement;
const txtObsidianTags = document.getElementById(
  'txt-obsidian-tags'
) as HTMLInputElement;
const tagsPreview = document.getElementById(
  'obsidian-tags-preview'
) as HTMLElement;
const btnTagsReset = document.getElementById(
  'btn-obsidian-tags-reset'
) as HTMLButtonElement;
const tagsAutocomplete = document.getElementById(
  'obsidian-tags-autocomplete'
) as HTMLDivElement;
const tagsFieldLabel = document.getElementById(
  'obsidian-tags-label'
) as HTMLLabelElement;
const txtFilenameTemplate = document.getElementById(
  'txt-filename-template'
) as HTMLInputElement;
const filenamePreview = document.getElementById(
  'filename-preview'
) as HTMLElement;

// ─── Footer version ───────────────────────────────────────────────────

const footerVersion = document.getElementById('footer-version');
if (footerVersion) {
  footerVersion.textContent = `v${chrome.runtime.getManifest().version}`;
}

// ─── Initialize i18n ──────────────────────────────────────────────────

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

// ─── Settings Persistence ───────────────────────────────────────────

const SETTINGS_KEY = 'tweet2md_settings';

type FieldMap = Record<string, boolean>;

interface Settings {
  downloadImages: boolean;
  includeMetadata: boolean;
  closeTabAfterExport: boolean;
  inlineButtonCopies: boolean;
  showInlineButton: boolean;
  inlineStats: boolean;
  obsidianFriendly: boolean;
  obsidianVault: string;
  obsidianFolder: string;
  obsidianTagsTemplate: string;
  downloadFolder: string;
  filenameTemplate: string;
  frontmatterFields: FieldMap;
  frontmatterFieldsObsidian: FieldMap;
  // Section ids in most-recently-opened order (max length = SECTION_MAX_OPEN).
  // Persisted so the user's last layout is restored on the next popup open.
  settingsSectionsOpen: string[];
}

const SECTION_IDS = ['downloads', 'obsidian', 'frontmatter', 'inline'] as const;
const SECTION_MAX_OPEN = 2;

function allEnabled(keys: readonly string[]): FieldMap {
  return Object.fromEntries(keys.map((k) => [k, true]));
}

const DEFAULT_SETTINGS: Settings = {
  downloadImages: false,
  includeMetadata: true, // on by default
  closeTabAfterExport: false,
  inlineButtonCopies: false, // inline button downloads by default
  showInlineButton: true, // inline button visible by default
  inlineStats: false, // off — changes visible content, opt-in
  obsidianFriendly: false, // off — changes frontmatter shape, opt-in
  obsidianVault: '', // empty → let Obsidian pick the last-used vault
  obsidianFolder: '', // empty → create note at the vault root
  obsidianTagsTemplate: '', // empty → use DEFAULT_TAGS_TEMPLATE in post-process
  downloadFolder: '', // empty → save directly in Downloads
  filenameTemplate: '', // empty → legacy {handle}-{id}.md / {handle}-{slug}.md
  frontmatterFields: allEnabled(FRONTMATTER_FIELDS_DEFAULT),
  frontmatterFieldsObsidian: allEnabled(FRONTMATTER_FIELDS_OBSIDIAN),
  settingsSectionsOpen: ['downloads', 'obsidian'],
};

async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const saved = (result[SETTINGS_KEY] || {}) as Partial<Settings>;
      // Merge field maps key-by-key: a saved map from an older version is
      // missing newly-added fields, and a hard spread would leave those keys
      // undefined → they'd render unchecked. Defaulting missing keys to true
      // keeps the rule "no saved choice = include the field".
      const frontmatterFields = {
        ...DEFAULT_SETTINGS.frontmatterFields,
        ...(saved.frontmatterFields || {}),
      };
      const frontmatterFieldsObsidian = {
        ...DEFAULT_SETTINGS.frontmatterFieldsObsidian,
        ...(saved.frontmatterFieldsObsidian || {}),
      };
      const rawSections = Array.isArray(saved.settingsSectionsOpen)
        ? saved.settingsSectionsOpen.filter((id): id is string =>
            typeof id === 'string' && (SECTION_IDS as readonly string[]).includes(id)
          )
        : DEFAULT_SETTINGS.settingsSectionsOpen;
      // Deduplicate while preserving order, then trim to the cap.
      const settingsSectionsOpen = Array.from(new Set(rawSections)).slice(0, SECTION_MAX_OPEN);

      resolve({
        ...DEFAULT_SETTINGS,
        ...saved,
        frontmatterFields,
        frontmatterFieldsObsidian,
        settingsSectionsOpen,
      });
    });
  });
}

function saveSettings(settings: Settings): void {
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function updateInlineCopiesEnabled(): void {
  const enabled = chkShowInline.checked;
  chkInlineCopies.disabled = !enabled;
  chkInlineCopies.closest('.toggle-label')?.classList.toggle('disabled', !enabled);
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

// Restore toggle states on popup open
loadSettings().then((settings) => {
  chkDownloadImages.checked = settings.downloadImages;
  chkMetadata.checked = settings.includeMetadata;
  chkCloseTab.checked = settings.closeTabAfterExport;
  chkInlineCopies.checked = settings.inlineButtonCopies;
  chkShowInline.checked = settings.showInlineButton;
  chkInlineStats.checked = settings.inlineStats;
  chkObsidianFriendly.checked = settings.obsidianFriendly;
  txtObsidianVault.value = settings.obsidianVault;
  txtObsidianFolder.value = settings.obsidianFolder;
  txtObsidianTags.value = settings.obsidianTagsTemplate;
  txtDownloadFolder.value = settings.downloadFolder;
  txtFilenameTemplate.value = settings.filenameTemplate;
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

function persistAll(): void {
  saveSettings({
    downloadImages: chkDownloadImages.checked,
    includeMetadata: chkMetadata.checked,
    closeTabAfterExport: chkCloseTab.checked,
    inlineButtonCopies: chkInlineCopies.checked,
    showInlineButton: chkShowInline.checked,
    inlineStats: chkInlineStats.checked,
    obsidianFriendly: chkObsidianFriendly.checked,
    obsidianVault: txtObsidianVault.value.trim(),
    obsidianFolder: txtObsidianFolder.value.trim(),
    obsidianTagsTemplate: txtObsidianTags.value.trim(),
    downloadFolder: txtDownloadFolder.value.trim(),
    filenameTemplate: txtFilenameTemplate.value.trim(),
    frontmatterFields,
    frontmatterFieldsObsidian,
    settingsSectionsOpen,
  });
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

sectionDetailsById.forEach((el, id) => {
  el.addEventListener('toggle', () => handleSectionToggle(id, el.open));
});

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

// ─── Filename template preview ─────────────────────────────────────

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

// ─── Tags template: preview, enable/disable, autocomplete ──────────

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

txtObsidianTags.addEventListener('input', () => {
  updateTagsPreview();
  handleTagsAutocompleteOnInput();
});
txtObsidianTags.addEventListener('change', persistAll);
txtObsidianTags.addEventListener('blur', () => {
  // Delay just enough to let an autocomplete click register before the popover
  // is forced shut by the blur.
  setTimeout(() => {
    closeTagsAutocomplete();
    persistAll();
  }, 120);
});

btnTagsReset.addEventListener('click', (e) => {
  e.preventDefault();
  txtObsidianTags.value = '';
  updateTagsPreview();
  closeTagsAutocomplete();
  persistAll();
});

// ─── Placeholder autocomplete (`{` opens, filters as user types) ──

interface AutocompleteState {
  triggerStart: number; // index of the `{` in the input
  highlighted: number; // index of the currently highlighted option
  items: readonly string[]; // placeholders without braces
}

let autocompleteState: AutocompleteState | null = null;

function closeTagsAutocomplete(): void {
  autocompleteState = null;
  tagsAutocomplete.hidden = true;
  tagsAutocomplete.replaceChildren();
}

function renderAutocomplete(items: readonly string[], highlighted: number): void {
  tagsAutocomplete.replaceChildren(
    ...items.map((name, i) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'placeholder-autocomplete-item' + (i === highlighted ? ' highlighted' : '');
      opt.textContent = `{${name}}`;
      opt.addEventListener('mousedown', (e) => {
        // mousedown (not click) so the input's blur doesn't race with selection
        e.preventDefault();
        applyAutocompleteChoice(i);
      });
      return opt;
    })
  );
  tagsAutocomplete.hidden = false;
}

function handleTagsAutocompleteOnInput(): void {
  const caret = txtObsidianTags.selectionStart ?? txtObsidianTags.value.length;
  // Walk back from the caret to the most recent `{` not yet closed.
  const head = txtObsidianTags.value.slice(0, caret);
  const open = head.lastIndexOf('{');
  if (open < 0) {
    closeTagsAutocomplete();
    return;
  }
  const fragment = head.slice(open + 1);
  // A `}` between the `{` and the caret means the placeholder is already
  // closed; the next `{` (if any) will open a new context on a later keystroke.
  if (fragment.includes('}')) {
    closeTagsAutocomplete();
    return;
  }
  const filtered = TAGS_PLACEHOLDERS.filter((p) => p.startsWith(fragment));
  if (filtered.length === 0) {
    closeTagsAutocomplete();
    return;
  }
  autocompleteState = { triggerStart: open, highlighted: 0, items: filtered };
  renderAutocomplete(filtered, 0);
}

function applyAutocompleteChoice(index: number): void {
  if (!autocompleteState) return;
  const choice = autocompleteState.items[index];
  if (!choice) return;
  const value = txtObsidianTags.value;
  const caret = txtObsidianTags.selectionStart ?? value.length;
  const before = value.slice(0, autocompleteState.triggerStart);
  const after = value.slice(caret);
  const insertion = `{${choice}}`;
  txtObsidianTags.value = before + insertion + after;
  const newCaret = before.length + insertion.length;
  txtObsidianTags.setSelectionRange(newCaret, newCaret);
  closeTagsAutocomplete();
  updateTagsPreview();
  persistAll();
  txtObsidianTags.focus();
}

txtObsidianTags.addEventListener('keydown', (e) => {
  if (!autocompleteState) return;
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      const next = (autocompleteState.highlighted + 1) % autocompleteState.items.length;
      autocompleteState.highlighted = next;
      renderAutocomplete(autocompleteState.items, next);
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const len = autocompleteState.items.length;
      const next = (autocompleteState.highlighted - 1 + len) % len;
      autocompleteState.highlighted = next;
      renderAutocomplete(autocompleteState.items, next);
      break;
    }
    case 'Enter':
    case 'Tab':
      e.preventDefault();
      applyAutocompleteChoice(autocompleteState.highlighted);
      break;
    case 'Escape':
      e.preventDefault();
      closeTagsAutocomplete();
      break;
  }
});

chkDownloadImages.addEventListener('change', persistAll);
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
txtFilenameTemplate.addEventListener('input', updateFilenamePreview);
txtFilenameTemplate.addEventListener('change', persistAll);
txtFilenameTemplate.addEventListener('blur', persistAll);

// ─── ⓘ placeholder-list popovers (filename template, Obsidian tags) ──

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

// ─── Helpers ────────────────────────────────────────────────────────

function showStatus(
  message: string,
  type: 'success' | 'error' | 'info'
): void {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusEl.className = 'status hidden';
    }, 3000);
  }
}

function setLoading(loading: boolean, target?: 'download' | 'copy' | 'obsidian' | 'pdf'): void {
  btnDownload.disabled = loading;
  btnCopy.disabled = loading;
  btnObsidian.disabled = loading;
  btnPdf.disabled = loading;

  // Only animate the button that was actually clicked
  if (target === 'download' || !target) {
    btnDownload.classList.toggle('loading', loading);
    const dlLabel = btnDownload.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_download') || 'Download .md');
  }
  if (target === 'copy' || !target) {
    btnCopy.classList.toggle('loading', loading);
    const cpLabel = btnCopy.querySelector('.btn-label');
    if (cpLabel) cpLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_copy') || 'Copy .md');
  }
  if (target === 'obsidian' || !target) {
    btnObsidian.classList.toggle('loading', loading);
    const obLabel = btnObsidian.querySelector('.btn-label');
    if (obLabel) obLabel.textContent = loading ? (chrome.i18n.getMessage('extracting') || 'Extracting…') : (chrome.i18n.getMessage('btn_obsidian') || 'Add to Obsidian');
  }
  if (target === 'pdf' || !target) {
    btnPdf.classList.toggle('loading', loading);
    const pdfLabel = btnPdf.querySelector('.btn-label');
    if (pdfLabel) pdfLabel.textContent = loading ? (chrome.i18n.getMessage('rendering_pdf') || 'Rendering PDF…') : (chrome.i18n.getMessage('btn_pdf') || 'Download .pdf');
  }

  // When stopping, always reset all four to default state
  if (!loading) {
    btnDownload.classList.remove('loading');
    btnCopy.classList.remove('loading');
    btnObsidian.classList.remove('loading');
    btnPdf.classList.remove('loading');
    const dlLabel = btnDownload.querySelector('.btn-label');
    const cpLabel = btnCopy.querySelector('.btn-label');
    const obLabel = btnObsidian.querySelector('.btn-label');
    const pdfLabel = btnPdf.querySelector('.btn-label');
    if (dlLabel) dlLabel.textContent = chrome.i18n.getMessage('btn_download') || 'Download .md';
    if (cpLabel) cpLabel.textContent = chrome.i18n.getMessage('btn_copy') || 'Copy .md';
    if (obLabel) obLabel.textContent = chrome.i18n.getMessage('btn_obsidian') || 'Add to Obsidian';
    if (pdfLabel) pdfLabel.textContent = chrome.i18n.getMessage('btn_pdf') || 'Download .pdf';
  }
}

// ─── Shared Extraction ──────────────────────────────────────────────

async function extractMarkdown(
  forAction: 'download' | 'copy' | 'obsidian' = 'download',
): Promise<PostProcessResult> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error('Unable to access the current tab.');
  }

  const url = tab.url || '';
  if (!hostMatches(url, 'x.com', 'www.x.com')) {
    throw new Error(chrome.i18n.getMessage('footer_hint') || 'Navigate to a tweet or article on X.com first.');
  }

  if (!url.includes('/status/')) {
    throw new Error(
      chrome.i18n.getMessage('error_specific_page') || 'Open a specific tweet or article page (with /status/ in the URL).'
    );
  }

  const includeMetadata = chkMetadata.checked;
  const inlineStats = chkInlineStats.checked;
  // "Add to Obsidian" is *the* Obsidian path — force the Obsidian schema
  // regardless of the toggle (the toggle exists for the Download/Copy
  // flows where the user may or may not be heading to Obsidian).
  const obsidianFriendly = forAction === 'obsidian' ? true : chkObsidianFriendly.checked;
  // Local image folders make no sense for the deeplink — Obsidian receives
  // markdown via URL, not a filesystem package, so leave images as remote
  // URLs (Obsidian renders pbs.twimg.com inline fine).
  const downloadImages =
    forAction === 'obsidian' ? false : resolveDownloadImages(forAction, chkDownloadImages.checked);

  const response: ExtractResponse = await chrome.tabs.sendMessage(tab.id, {
    action: 'EXTRACT',
    // Need engagement data if either renderer wants it.
    includeMetadata: includeMetadata || inlineStats,
  });

  if (!response.success || !response.data) {
    throw new Error(response.error || chrome.i18n.getMessage('error_failed') || 'Failed to extract content.');
  }

  return postProcess(response.data, {
    includeMetadata,
    downloadImages,
    inlineStats,
    obsidianFriendly,
    filenameTemplate: txtFilenameTemplate.value.trim(),
    obsidianTagsTemplate: txtObsidianTags.value.trim(),
    frontmatterFields: obsidianFriendly ? frontmatterFieldsObsidian : frontmatterFields,
  });
}

function handleExtractionError(err: unknown): void {
  const message =
    err instanceof Error ? err.message : (chrome.i18n.getMessage('error_unexpected') || 'An unexpected error occurred.');

  if (message.includes('Receiving end does not exist')) {
    showStatus(chrome.i18n.getMessage('error_reload') || 'Reload the page and try again.', 'error');
  } else {
    showStatus(message, 'error');
  }
  setLoading(false);
}

// ─── Download Flow ──────────────────────────────────────────────────

btnDownload.addEventListener('click', async () => {
  setLoading(true, 'download');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown();

    const downloadMsg: DownloadRequest = {
      action: 'DOWNLOAD_MD',
      content: result.markdown,
      filename: result.filename,
      images: result.images.length > 0 ? result.images : undefined,
    };

    chrome.runtime.sendMessage(downloadMsg, (downloadResponse) => {
      if (chrome.runtime.lastError || !downloadResponse?.success) {
        showStatus(downloadResponse?.error || chrome.i18n.getMessage('download_failed') || 'Download failed.', 'error');
      } else {
        const typeLabels: Record<string, string> = {
          article: chrome.i18n.getMessage('article_downloaded') || 'Article downloaded!',
          thread: chrome.i18n.getMessage('thread_downloaded') || 'Thread downloaded!',
          tweet: chrome.i18n.getMessage('tweet_downloaded') || 'Tweet downloaded!',
        };
        const label = typeLabels[result.type] || chrome.i18n.getMessage('downloaded') || 'Downloaded!';
        showStatus(`✓ ${label}`, 'success');
      }
      setLoading(false);
    });
  } catch (err) {
    handleExtractionError(err);
  }
});

// ─── Copy Flow ──────────────────────────────────────────────────────

// ─── PDF Export Flow ────────────────────────────────────────────────

btnPdf.addEventListener('click', async () => {
  setLoading(true, 'pdf');
  statusEl.className = 'status hidden';
  try {
    const [tab] = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    if (!tab?.id) {
      showStatus(chrome.i18n.getMessage('error_no_tab') || 'No active tab.', 'error');
      setLoading(false);
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'EXPORT_PDF' }, (resp) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        // Same friendly hint as the markdown flow: content script isn't on
        // this page (non-/status/ URL or just-reloaded extension).
        if (msg.includes('Receiving end does not exist')) {
          showStatus(chrome.i18n.getMessage('error_reload') || 'Reload the page and try again.', 'error');
        } else {
          showStatus(msg || 'PDF export failed.', 'error');
        }
      } else if (!resp?.success) {
        showStatus(resp?.error || chrome.i18n.getMessage('pdf_failed') || 'PDF export failed.', 'error');
      } else {
        showStatus(`✓ ${chrome.i18n.getMessage('pdf_downloaded') || 'PDF downloaded!'}`, 'success');
      }
      setLoading(false);
    });
  } catch (err) {
    handleExtractionError(err);
  }
});

// ─── Add to Obsidian Flow ───────────────────────────────────────────

btnObsidian.addEventListener('click', async () => {
  setLoading(true, 'obsidian');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown('obsidian');
    const vault = txtObsidianVault.value.trim();
    const folder = txtObsidianFolder.value.trim();
    const url = buildObsidianUrl(result.markdown, result.filename, vault, folder);

    // Navigate the popup itself to the obsidian:// URL. The OS handler picks
    // it up; the popup closes either way, so we don't leave a blank tab.
    window.location.href = url;

    showStatus(`✓ ${chrome.i18n.getMessage('obsidian_opened') || 'Opening Obsidian…'}`, 'success');
    setLoading(false);
  } catch (err) {
    handleExtractionError(err);
  }
});

btnCopy.addEventListener('click', async () => {
  setLoading(true, 'copy');
  statusEl.className = 'status hidden';

  try {
    const result = await extractMarkdown('copy');

    await navigator.clipboard.writeText(result.markdown);

    const typeLabels: Record<string, string> = {
      article: chrome.i18n.getMessage('article_copied') || 'Article copied!',
      thread: chrome.i18n.getMessage('thread_copied') || 'Thread copied!',
      tweet: chrome.i18n.getMessage('tweet_copied') || 'Tweet copied!',
    };
    const label = typeLabels[result.type] || chrome.i18n.getMessage('copied') || 'Copied!';
    showStatus(`✓ ${label}`, 'success');
    setLoading(false);
  } catch (err) {
    handleExtractionError(err);
  }
});
