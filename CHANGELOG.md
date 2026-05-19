# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Filename Template**: New setting under **Downloads** that takes a template for the exported filename. Supported placeholders: `{date}`, `{datetime}`, `{handle}`, `{author}`, `{id}`, `{slug}`, `{type}`. Each value is sanitized for filesystem-invalid characters (`/\:*?"<>|`), the final filename is capped at 120 characters, and the settings view shows a live preview. Leave blank to keep the previous default (`{handle}-{id}.md` for tweets/threads, `{handle}-{slug}.md` for articles). An info popover next to the field lists every placeholder with a short description. Combines with the **Downloads Subfolder** setting from 1.6.0. (#24)

### Changed

- **Settings View Polish**: Hides the popup header (logo, tagline, hint) on the Settings view to keep the panel compact, and adds a small "Hover over labels for more info" hint near the top so the existing per-label tooltips are easier to discover.

## [1.6.0] - 2026-05-18

### Added

- **Downloads Subfolder**: New setting under **Downloads** that places exported Markdown and images inside a subfolder of the browser's Downloads folder, instead of dumping everything at the top level. Leave blank for the previous behavior. Traversal (`..`), leading slashes, and illegal filename characters are stripped before the path is handed to `chrome.downloads.download`. (#17)
- **Obsidian Vault Subfolder**: New setting under **Obsidian** that creates the note inside a specified subfolder of the vault (e.g. `Tweets` or `Inbox/Tweets`) via the `file=` parameter of the `obsidian://new` URI. Traversal segments and stray slashes are stripped. Leave blank to keep notes at the vault root. (#18)

### Changed

- **Extension Name**: Renamed to *X Threads Articles to Markdown or Obsidian* across all 9 supported locales for better Chrome Web Store search match. The manifest now references `__MSG_extensionName__` so each locale ships a translated name; `short_name` stays as `tweet2md` for the OS-level short label.

### Fixed

- **Obsidian handoff vs. close-after-export**: When *Add tweet to Obsidian* was triggered from the context menu on a timeline (which opens a new tab) with **Close the new tab after export** enabled, the tab was closed before the browser's "Open Obsidian.app?" prompt could be confirmed, dropping the handoff. The auto-close now skips the Obsidian action so the user can answer the prompt; download/copy actions still respect the toggle. (#16)

## [1.5.1] - 2026-05-16

### Security

- **Hostname Sanitization**: Replaced substring-based host checks (e.g. `url.includes('pbs.twimg.com')`) with proper URL parsing via a new `hostMatches` helper that compares parsed hostnames exactly. Fixes 9 CodeQL `js/incomplete-url-substring-sanitization` alerts across `content/article.ts`, `content/markdown.ts`, `content/tweet.ts`, and `popup/popup.ts`. The popup's "are we on x.com?" gate is tightened from a substring test to an exact host match against the manifest's allowed hosts.

### Changed

- **Extension Description**: The Chrome Web Store / manifest description now mentions the Obsidian handoff. Updated across all 9 supported locales.

## [1.5.0] - 2026-05-15

### Added

- **Add to Obsidian**: One-click handoff that opens Obsidian via the `obsidian://new` URI scheme with the rendered Markdown prefilled. Forces Obsidian-friendly frontmatter and leaves images as remote URLs (local image downloads don't make sense for a URI handoff). The handoff is local — no network call.
- **Obsidian-friendly Frontmatter**: Optional export schema with wikilinked author handles (e.g. `[[@username]]`) for backlinks, a synthesized title, `published` / `created` date split, prose `description` snippet, and a `tags: [clippings, x, <type>]` array. Engagement metrics remain at the bottom for Dataview queries. Toggle off = byte-for-byte identical to the previous schema.
- **Obsidian Vault Setting**: Optional vault name field in Settings; included as `vault=` in the deeplink so notes land in a specific vault. Leave blank to let Obsidian pick the last-used vault.
- **Link Cards**: External link previews in tweets are now captured. Extracts the title, source domain, and embeds the Open Graph preview image (intentionally kept as a remote URL to avoid pulling third-party thumbnails into local sibling folders).
- **Multi-View Popup**: The popup now separates primary actions from configuration. The settings view sits behind a gear icon at the top-right of the popup; clicking it slides to the configuration panel.

### Changed

- **Grouped Settings**: The "Inline button & context menu" toggles plus Obsidian settings (toggle + vault name) live in the dedicated settings view; the main popup view is focused on Download / Copy / Add to Obsidian and the per-export toggles.
- **Popup Layout**: Buttons restructured into a half-width grid — Download / Copy on top, the Export options card below, then a half-width Obsidian button with its hint paragraph paired beside it.

## [1.4.1] - 2026-05-12

### Added

- **Promoted Tweet Skipping**: Thread extraction now recognises locale-aware "Ad" / "Promoted" labels (English, Japanese, German, Spanish, French, Chinese, Arabic, Persian) in the tweet header and skips them, so an ad injected mid-thread no longer ends collection at the reply boundary. (thanks @BigCactusLabs, #7)
- **K/M/B Engagement Counts**: Engagement metrics are now parsed correctly when X compacts them (e.g. `1.5K likes`, `2M views`). Previously these were dropped from the YAML frontmatter and the inline stats row. (thanks @BigCactusLabs, #7)

### Changed

- **Quoted-Tweet Media Order**: When a tweet contains both its own media and a quoted tweet, the main tweet's images/videos now appear *before* the quoted block (matching X's visual order). Media belonging to the quoted tweet is nested inside the blockquote.

### Fixed

- **Duplicate Video Poster**: When X hydrated both a poster `<img>` and a full `<video>` element for the same clip (most visible in quoted tweets), the same thumbnail was emitted twice. Now deduplicated. (thanks @BigCactusLabs, #7)

### Internal

- Added a `CONTRIBUTING.md` with the snapshot-test discipline, fixture-capture procedure, and extractor scope conventions.
- GitHub Actions CI workflow added for tests and build. `package.json` and lockfile aligned with Vitest's esbuild peer dependency. (thanks @BigCactusLabs, #8)

## [1.4.0] - 2026-05-11

### Added

- **In-Place Extraction**: When you click the inline button or pick a context-menu action on a tweet you're already viewing (its permalink page), tweet2md extracts in the current tab instead of opening a duplicate one. The "Close the new tab after export" toggle never closes your active tab.
- **In-Page Toast**: In-place extractions show a brief top-center toast confirming *Copied!* / *Downloaded!* — localized in all 9 supported languages — so you have feedback without the new-tab signal.
- **Show Inline Button toggle**: A new popup toggle lets you hide the inline download icon on tweets if it conflicts visually with another extension. Off-state hides existing buttons live, no page reload needed.
- **Show Engagement Stats Inline toggle**: Optional X-style stats row in the exported Markdown (e.g. `💬 284 · 🔁 1.5K · ❤️ 8K · 🔖 253 · 👁 100K`), independent of YAML frontmatter so you can have either or both.
- **Grouped Settings**: Popup options are organized into *Export* and *Inline button & context menu* sections so 6 toggles stay scannable.

### Security

- Background download handling now validates the message sender before invoking privileged download APIs — requests are only honored from x.com content scripts or trusted extension pages.
- Local image downloads are restricted to expected X media hosts (`pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`, `abs-0.twimg.com`); other external image URLs are left as remote Markdown links rather than downloaded.
- Strengthened filename / path sanitization to drop `..` segments and absolute paths and to normalize unicode before passing to Chrome's download API.
- Contributed by [@BigCactusLabs] (#6).

### Changed

- **Inline Button Visual Match**: Icon redesigned with X's solid-fill style (no more line-art stroke) and now reads the sibling action-bar icon at decoration time to match its exact rendered size and color in every X surface (timeline vs focused tweet, light vs dark theme).
- **Cleaner Context Menu**: Save / Copy items now nest under an explicit "tweet2md" parent label instead of Chrome's auto-grouped full extension name. Also added a `short_name` in the manifest for other space-constrained UI surfaces.
- **Toast Position**: Moved to top-center with a 2-second hold so it's harder to miss.
- **Wording**: "Close tab after export" → "Close the new tab after export" — clearer that only the tab tweet2md opened will close, never your active one.
- **Internal Refactor**: `content.ts` was split into focused modules (`markdown`, `dom`, `tweet`, `article`, `wait`), and the "copy never downloads images" rule was consolidated into one shared helper. No behavior change.

### Fixed

- **Iran Flag (and other glyph) Renders As Full Image**: SVG glyphs served from `abs.twimg.com/responsive-web/client-web/...` weren't recognized as emoji and were being rendered as full-size images in the Markdown. All `.svg` images on X are now treated as glyphs and resolve to their alt-text character.
- **Tests on Fresh Checkouts**: The test suite now runs cleanly even when no local HTML/MD fixtures have been captured yet, so contributors can clone and `npm test` without setup.

## [1.3.0] - 2026-05-09

### Added

- **Inline Save Button**: A download icon now sits next to the share button on every tweet's action bar. One click opens the tweet's permalink in a new tab and exports it automatically — no popup required. Long-form articles also get a button at the top so you don't have to scroll.
- **Right-Click Context Menu**: Right-click any tweet (body, image, or timestamp) and pick **Save tweet as Markdown** or **Copy tweet as Markdown**. Works across timeline, profile, and search pages.
- **Two New Toggles**: *Close tab after export* (auto-closes the new tab once extraction completes) and *Inline button copies instead* (makes the inline icon copy to clipboard rather than download).
- **Author Attribution on Quoted Tweets**: Quoted-tweet blocks now lead with the original author's name and handle.
- **Automated Test Suite**: Vitest + JSDOM snapshot tests against saved HTML fixtures cover article, tweet, quoted-tweet, and thread cases — locking the extractor's output against regressions.

### Fixed

- **Article Image Extraction**: Long-form article body images (not just the banner) now extract reliably, including via inline button / context menu where image hydration was previously racing the extractor.
- **Right-Click on Permalink Pages**: Resolved a bug where right-clicking a long-form article that contained a quoted tweet would open the *quoted* tweet instead of the page's main one.
- **Article List Continuation**: Fixed bullet/numbered lists where the next paragraph was incorrectly folded into the last list item.
- **Copy vs. Save Image Settings**: The "Save images locally" toggle no longer rewrites image URLs to nonexistent local paths when copying to clipboard — copy now always emits absolute URLs.
- **Orphaned Script Errors**: Inline-button injector now silently disconnects when the extension is reloaded or disabled, eliminating "Extension context invalidated" console noise.

### Changed

- **Permission Added**: New `contextMenus` permission required for the right-click menu. No data collection, telemetry, or external requests are introduced — see [PRIVACY.md](PRIVACY.md).
- **Localization**: Added translations for the new settings and context-menu items across all 9 supported languages.

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
