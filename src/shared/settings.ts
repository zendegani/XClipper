// Single source of truth for user settings: the persisted shape, its defaults,
// and the load/save helpers. The popup writes these (from its form controls),
// while the content script and PDF flow read them back. Keeping one definition
// here is what stops the inline-button / context-menu paths from silently
// drifting out of sync with the popup when a new setting is added.
//
// Storage key migration (tweet2md → xclipper) is handled separately in the
// background service worker; by the time anything calls loadSettings() the
// data already lives under `xclipper_settings`.

import { FRONTMATTER_FIELDS_DEFAULT, FRONTMATTER_FIELDS_OBSIDIAN } from './post-process';

export const SETTINGS_KEY = 'xclipper_settings';

export type FieldMap = Record<string, boolean>;

export interface Settings {
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
  // Batch export: also write a combined digest.md into the job's folder.
  batchDigest: boolean;
  frontmatterFields: FieldMap;
  frontmatterFieldsObsidian: FieldMap;
  // Section ids in most-recently-opened order (max length = SECTION_MAX_OPEN).
  // Persisted so the user's last layout is restored on the next popup open.
  settingsSectionsOpen: string[];
}

export const SECTION_IDS = ['downloads', 'obsidian', 'frontmatter', 'inline'] as const;
export const SECTION_MAX_OPEN = 2;

export function allEnabled(keys: readonly string[]): FieldMap {
  return Object.fromEntries(keys.map((k) => [k, true]));
}

export const DEFAULT_SETTINGS: Settings = {
  downloadImages: false,
  includeMetadata: true, // on by default
  closeTabAfterExport: false,
  inlineButtonCopies: false, // inline button downloads by default
  showInlineButton: false, // off by default in v2.0.0 — avoids DOM conflicts with other X/Twitter extensions; v1.9.0 migrants keep their stored value
  inlineStats: false, // off — changes visible content, opt-in
  obsidianFriendly: false, // off — changes frontmatter shape, opt-in
  obsidianVault: '', // empty → let Obsidian pick the last-used vault
  obsidianFolder: '', // empty → create note at the vault root
  obsidianTagsTemplate: '', // empty → use DEFAULT_TAGS_TEMPLATE in post-process
  downloadFolder: '', // empty → save directly in Downloads
  filenameTemplate: '', // empty → legacy {handle}-{id}.md / {handle}-{slug}.md
  batchDigest: false, // off — extra file per batch, opt-in
  frontmatterFields: allEnabled(FRONTMATTER_FIELDS_DEFAULT),
  frontmatterFieldsObsidian: allEnabled(FRONTMATTER_FIELDS_OBSIDIAN),
  settingsSectionsOpen: ['downloads', 'obsidian'],
};

export async function loadSettings(): Promise<Settings> {
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

export function saveSettings(settings: Settings): void {
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
