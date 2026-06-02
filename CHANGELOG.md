# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- **Obsidian row redesign**: The *Add to Obsidian* button no longer shares its row with a hint paragraph that clipped its label in some locales (e.g. German, Russian). The button is centered at ~62.5% width and the hint moved into a ⓘ tooltip on the right. The tooltip now also nudges toward Settings: *Configure vault, subfolder, and frontmatter fields in Settings. Use the 'Download .md' button for long threads or images.* Translated across all 12 locales. (#33)
- **"Download .md" hint wording**: The reference to the Download button is now wrapped in quotes — single quotes for most languages, 「…」 for ja and zh_CN — so it's unambiguously read as a button label, not a separate tool. pt_BR / hi / ja hints also realigned to match their actual button labels. (#33)
- **"Activate all" button**: More horizontal padding and `nowrap` so the label has room and never wraps in long-translation locales. (#33)

### Fixed

- **Right-to-left layout (Arabic, Persian)**: The popup now sets `<html dir>` and `<html lang>` from the active UI locale, so bidi text (e.g. *Markdown* in an Arabic sentence) flows in the correct position. Layout, gear icon, footer version, tooltips, and toggle knobs all mirror via CSS logical properties. (#34)

## [1.7.0] - 2026-05-30

### Added

- **Single-Tweet Export**: New **Copy just this tweet (no thread)** context-menu item, plus Shift- or Alt-clicking the inline button, exports only the focused tweet instead of the whole thread. Default behaviour is unchanged.
- **Three new UI languages**: Hindi, Italian, and Russian — bringing the popup UI to 12 supported locales.
- **Footer version link**: The popup footer version (e.g. `v1.7.0`) now links to this changelog on GitHub.

### Fixed

- **Polls**: Tweet polls are now captured — choices, result percentages once voted, and the vote total/status line. Previously they were dropped entirely. (#28)
- **Translation gaps**: Corrected a stale tooltip in 7 locales (the **Close the tab after export** option still described old behaviour), filled in 5 Frontmatter fields strings missing since 1.6.1 across the existing non-English locales, and polished hi/it/ru/fr wording per native review.
- **Thread completeness on deep-link permalinks**: Opening a mid-thread reply (e.g. the 10th tweet in a chain) now walks up to the thread root before exporting, so all parent tweets are captured. Tombstone articles (deleted or hidden parents) are skipped instead of terminating the walk. (#22)

## [1.6.1] - 2026-05-21

### Added

- **Filename Template**: New **Downloads** setting with placeholders (`{date}`, `{datetime}`, `{handle}`, `{author}`, `{id}`, `{slug}`, `{type}`) and a live preview in Settings. Filesystem-invalid characters are stripped; capped at 120 chars. Leave blank to keep the previous defaults. (#24)
- **Frontmatter Field Picker**: New **Frontmatter fields** section in Settings — per-field toggles to include/omit each YAML entry. Selections are saved separately for the default and Obsidian-friendly schemas, with an **Activate all** button per mode. The picker greys out when **Include metadata** is off, and the two toggles auto-keep each other in sync. (#25)
- **Version in Footer**: Popup footer shows the installed extension version (e.g. `v1.6.1`) so it's obvious what build is running.

### Changed

- **Collapsible Settings Sections**: The four Settings groups are now each collapsible, with Downloads + Obsidian open by default and a cap of two expanded at once. Opening Frontmatter fields auto-opens Obsidian (whose toggle picks the Frontmatter mode); the last layout is persisted.
- **Settings Topbar**: The "Hover over labels for more info" hint moved to a small ⓘ tooltip icon top-right so long translations don't crowd the topbar. The popup footer is hidden in the Settings view.
- **Instant CSS Tooltips**: All label/button tooltips migrated from native `title=` to a unified CSS pattern that stays inside the popup window, with consistent 500ms-delay behaviour.
- **Toolbar Icon**: Icons (16/32/48/128) now have a transparent background — no white square frame in dark mode. Rim cleaned via color-to-alpha so there's no antialiasing halo either.

## [1.6.0] - 2026-05-18

### Added

- **Downloads Subfolder**: New **Downloads** setting that places exported Markdown and images inside a subfolder of your Downloads folder. Leave blank for the previous behaviour. (#17)
- **Obsidian Vault Subfolder**: New **Obsidian** setting that creates the note inside a vault subfolder (e.g. `Tweets` or `Inbox/Tweets`). Leave blank to keep notes at the vault root. (#18)

### Changed

- **Extension Name**: Renamed to *X Threads Articles to Markdown or Obsidian* across all 9 locales for better Chrome Web Store search match. `short_name` remains `tweet2md`.

### Fixed

- **Obsidian handoff vs. close-after-export**: The new-tab auto-close used to fire before Chrome's "Open Obsidian.app?" prompt and dropped the handoff. The auto-close now skips the Obsidian action; download/copy still respect it. (#16)

## [1.5.1] - 2026-05-16

### Security

- **Hostname Sanitization**: Replaced substring-based host checks with a `hostMatches` helper that compares parsed hostnames exactly. Closes 9 CodeQL `js/incomplete-url-substring-sanitization` alerts and tightens the popup's x.com gate.

### Changed

- **Extension Description**: The Web Store description now mentions the Obsidian handoff. Updated across all 9 locales.

## [1.5.0] - 2026-05-15

### Added

- **Add to Obsidian**: One-click handoff via the `obsidian://new` URI scheme with the rendered Markdown prefilled. Local — no network call. Forces Obsidian-friendly frontmatter; images stay as remote URLs.
- **Obsidian-friendly Frontmatter**: Optional export schema with wikilinked author handles (`[[@username]]`), synthesized title, `published`/`created` dates, prose `description`, and `tags: [clippings, x, <type>]`. Toggle off = identical to the previous schema.
- **Obsidian Vault Setting**: Optional vault name in Settings; included in the deeplink so notes land in a specific vault. Blank = Obsidian picks the last-used vault.
- **Link Cards**: External link previews in tweets are now captured (title, source domain, Open Graph image — kept as a remote URL).
- **Multi-View Popup**: A gear icon at the top-right slides over to a dedicated settings view, separating per-export controls from set-once configuration.

### Changed

- **Grouped Settings**: Inline-button / context-menu toggles and Obsidian settings moved into the settings view; the main view focuses on Download / Copy / Add to Obsidian and per-export toggles.
- **Popup Layout**: Download/Copy split into a half-width grid on top, Export options card below, and a half-width Obsidian button paired with its hint paragraph.

## [1.4.1] - 2026-05-12

### Added

- **Promoted Tweet Skipping**: Thread extraction recognises locale-aware "Ad" / "Promoted" labels and skips them, so a mid-thread ad no longer cuts collection short. (thanks @BigCactusLabs, #7)
- **K/M/B Engagement Counts**: Compact metrics like `1.5K likes` or `2M views` are now parsed instead of dropped. (thanks @BigCactusLabs, #7)

### Changed

- **Quoted-Tweet Media Order**: A tweet's own media now renders before the quoted block, matching X's visual order. Quoted media stays nested inside the blockquote.

### Fixed

- **Duplicate Video Poster**: Deduplicated cases where X hydrated both a poster `<img>` and a `<video>` for the same clip. (thanks @BigCactusLabs, #7)

### Internal

- Added `CONTRIBUTING.md` covering snapshot-test discipline and fixture capture.
- GitHub Actions CI for tests and build. (thanks @BigCactusLabs, #8)

## [1.4.0] - 2026-05-11

### Added

- **In-Place Extraction**: Triggering the inline button or context menu on a tweet's permalink page now extracts in the current tab instead of opening a duplicate. The auto-close toggle never closes your active tab.
- **In-Page Toast**: Brief top-center *Copied!* / *Downloaded!* confirmation for in-place extractions, localized in all 9 languages.
- **Show Inline Button toggle**: Hide the inline icon if it conflicts visually with another extension. Takes effect live, no reload.
- **Show Engagement Stats Inline toggle**: Optional X-style stats row in the Markdown (`💬 284 · 🔁 1.5K · ❤️ 8K · 🔖 253 · 👁 100K`), independent of YAML frontmatter.
- **Grouped Settings**: Popup options split into *Export* and *Inline button & context menu* sections so 6 toggles stay scannable.

### Security

- Background download handler now validates message sender — only x.com content scripts and trusted extension pages can trigger downloads.
- Local image downloads restricted to known X media hosts; everything else stays as remote Markdown links.
- Filename/path sanitization strengthened: drops `..` and absolute paths, normalizes unicode before download.
- Contributed by [@BigCactusLabs] (#6).

### Changed

- **Inline Button Visual Match**: Icon redesigned with X's solid-fill style and now mirrors the sibling action-bar icon's exact size and color across every X surface (timeline, focused tweet, light, dark).
- **Cleaner Context Menu**: Save / Copy items nest under an explicit "tweet2md" parent label instead of Chrome's auto-grouped full extension name.
- **Toast Position**: Top-center with a 2-second hold so it's harder to miss.
- **Wording**: "Close tab after export" → "Close the new tab after export" — clearer that only the tweet2md-opened tab closes.
- **Internal Refactor**: `content.ts` split into focused modules; the "copy never downloads images" rule consolidated into one helper. No behavior change.

### Fixed

- **SVG glyphs rendered as full images**: All `.svg` images on X (incl. the Iran flag) are now treated as glyphs and resolve to their alt-text character.
- **Tests on Fresh Checkouts**: Suite runs cleanly without any local HTML/MD fixtures captured yet.

## [1.3.0] - 2026-05-09

### Added

- **Inline Save Button**: Download icon next to share on every tweet's action bar — one click opens the permalink in a new tab and exports automatically. Long-form articles get one at the top.
- **Right-Click Context Menu**: Right-click any tweet (body, image, or timestamp) and pick **Save tweet as Markdown** or **Copy tweet as Markdown**. Works on timeline, profile, and search pages.
- **Two New Toggles**: *Close tab after export* and *Inline button copies instead*.
- **Author Attribution on Quoted Tweets**: Quoted blocks now lead with the original author's name and handle.
- **Automated Test Suite**: Vitest + JSDOM snapshot tests against saved HTML fixtures (article, tweet, quoted, thread) lock the extractor against regressions.

### Fixed

- **Article Image Extraction**: Body images extract reliably even from inline-button / context-menu triggers where hydration used to race the extractor.
- **Right-Click on Permalink Pages**: Fixed cases where right-clicking an article containing a quoted tweet opened the *quoted* tweet instead of the page's main one.
- **Article List Continuation**: Following paragraphs no longer get folded into the previous list item.
- **Copy vs. Save Image Settings**: Copy-to-clipboard always emits absolute image URLs, even when "Save images locally" is on.
- **Orphaned Script Errors**: Inline-button injector now disconnects cleanly when the extension reloads — no more "Extension context invalidated" console noise.

### Changed

- **Permission Added**: New `contextMenus` permission for the right-click menu. No data collection, telemetry, or network calls — see [PRIVACY.md](PRIVACY.md).
- **Localization**: Translations for the new settings and context-menu items added across all 9 languages.

## [1.2.1] - 2026-04-19

### Added

- Added promotional web store assets to project repository.

### Changed

- **Popup UI**: Relocated the instruction hint to the header and updated the footer to include a direct link to the GitHub repository for issues and suggestions.
- **Localization**: Polished translations across 9 supported languages to ensure better native phrasing.
- **Manifest**: Updated extension metadata and localized descriptions for Web Store consistency.

## [1.2.0] - 2026-04-01

### Added

- **Copy to Clipboard**: Added a "Copy .md" button to the popup to copy generated markdown directly to your clipboard instead of downloading.
- **Multi-Language UI**: Popup interface now available in 9 languages — English, Spanish, German, French, Japanese, Portuguese (Brazil), Chinese (Simplified), Arabic, and Persian. The UI automatically matches your browser's language. Content extraction works on any language regardless of UI translation.
- **Dynamic Theming**: Added light and dark mode support to the popup UI, automatically respecting your system preferences.

### Fixed

- **Markdown Formatting**: Fixed a bug causing improper bold and italic rendering when text nodes contained trailing or leading whitespaces.

## [1.1.0] - 2026-03-22

### Added

- **Local Image Downloads**: Added a popup option to download all attached images locally into a subfolder next to the markdown file. The generated markdown automatically updates `![alt]` tags to reference the new local paths.
- **Tweet Metadata**: Added a toggle to include engagement metrics (likes, reposts, replies, bookmarks, views) as YAML frontmatter at the top of the generated markdown file.
- **Settings Persistence**: Popup toggles now remember your preferences between sessions.

### Improved

- **Quote Tweet Extraction**: Refined extraction logic to accurately differentiate between main tweet text and quoted tweet text, preventing messy or duplicated text in the output.
- **Popup UI**: Replaced basic checkboxes with modern, animated toggle switches with SVGs.
- **Path Sanitization**: Better handling of invalid characters in generated markdown and image filenames.

## [1.0.0] - 2026-02-15

### Initial Features

- Core extraction functionality for basic tweets, threads, and X Articles/Notes.
- Automatic DOM cleaning to strip follow buttons, engagement bars, and unwanted navigation.
- Turndown.js integration with custom rules for inline links, emojis, and @mentions.
