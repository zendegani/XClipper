# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed

- **Manual batch now saves videos as files, like Auto and Super**: with local saving on **Media**, a Manual batch wrote each post's video as its thumbnail and stopped there — the same posts run through Auto came out with an `.mp4` and a `▶ Video` link, so the engine you picked silently changed what you got. The batch orchestrator now resolves each post's video the way single export does and rebuilds that item's Markdown around the file. The worker tab still can't ask for it itself — that channel replays your X session and stays closed to page scripts — so the resolution happens in the background, where the batch already runs. (#118)
- **Article videos now survive a Manual or single export too**: a video in an X Article body reached the export only when the page happened to have its player mounted *and* silent. Otherwise it left as a paragraph reading the video's length — `18:48` — or vanished with no trace, the text running straight from the paragraph before it to the paragraph after. The player is now recognised in every state it renders in, so Manual and single exports keep the video where Auto and Super already did, thumbnail in place and saved as an `.mp4` when local saving is on **Media**. An article video XClipper genuinely can't read now fails the export loudly instead of quietly leaving a hole in it. (#118)

---

## [2.8.1] - 2026-08-29

### Fixed

- **Off · Images · Media no longer loses its last option in translation**: in locales whose words run longer — Spanish's *Desactivado · Imágenes · Multimedia*, French's *Médias*, German's *Medien* — the setting's label crowded the three-way control and its last position was clipped away by the control's own overflow, so **Media** could be neither seen nor clicked. The control now keeps its full width and moves to its own line beneath the label when the row is too narrow for both; English, Japanese and Chinese keep the single-line row they had.

---

## [2.8.0] - 2026-08-28

### Added

- **Videos and GIFs now save as files in Auto and Super**: the local-saving control in Export settings is now **Off · Images · Media**, and the new **Media** position saves each post's video or animated GIF as an `.mp4` next to the Markdown alongside the images, with a `▶ Video` link in the Markdown pointing at the local file. Quoted posts' videos come down too. Video is saved at up to 720p — X offers rungs as high as 4K, where one long post alone can run to several hundred megabytes. Auto and Super only, and only with **Markdown** format and **Separate** output; the handful of posts X serves as a stream with no downloadable file keep their thumbnail as before, unchanged. Videos are orders of magnitude larger than images, so **Media** is its own position rather than something folded into image saving — if you already had local images on you're on **Images**, and nothing changes until you choose **Media** yourself. (#95)
- **Single exports can now be packed into one .zip**: the **Zip files** option is no longer batch-only — it now sits above the batch settings and applies to a single post too. With local saving on, a post lands as one archive holding the Markdown and its media instead of a Markdown file plus a sibling media folder you have to keep together by hand, which makes it one file to drop into a note, an archive, or an AI chat. Batch keeps its existing rule: Zip and local media stay mutually exclusive there, because a thousand posts' media won't fit through the archive's delivery path. If a media file can't be fetched, it's left out and the rest of the export still lands. (thanks @santhonys for raising it, #115)
- **Single exports can now save videos too**: choosing **Media** in Export settings previously did nothing beyond images outside Auto and Super, because a page only ever exposes a video's thumbnail. Picking Media now asks for the same optional permission the Auto and Super engines use, resolves the post's video through your own X session, and saves it as an `.mp4` with a `▶ Video` link pointing at the file. Decline the permission and nothing breaks — Media still saves images and videos stay as links, exactly as before.

### Fixed

- **Videos inside X Articles no longer vanish from Auto and Super exports**: a video placed in the body of an X Article was dropped from the export entirely — the text ran straight from the paragraph before it to the paragraph after, with no thumbnail and nothing to show something had been there. The video's thumbnail now appears in its proper place, whichever local-saving position you're on. (#95)
- **Videos in an X Article body are now recognised as videos**: an article-body video was extracted as a plain image of its thumbnail, so it could never be saved as a file the way the same video in a post already was. It is now treated as a video on both paths, which also means its thumbnail is labelled `🎥 Video` rather than `Image` in the Markdown.
- **X Article headings no longer disappear in a narrow window**: X renders an article's blocks with a `-narrow` class variant when the reading column is narrow, and XClipper only recognised the standard names — so exporting an article from a narrow window silently flattened every heading into an ordinary paragraph, losing the whole document structure. Both variants are now recognised, for headings and bulleted lists alike. Caught by a new article fixture whose capture happened to be narrow.
- **PDF exports no longer print the day before**: a post exported to PDF showed its date in your computer's time zone, so anywhere west of UTC a late-evening post could print the previous day — disagreeing with the date in the same post's file name and Markdown frontmatter, which have always been UTC. All three now agree. Markdown and Obsidian exports were never affected. (#113)

---

## [2.7.4] - 2026-08-21

### Changed

- **Fast Batch no longer logs each captured request**: the background console wrote a line every time a bookmarks, likes or profile page fetched another batch of posts while you scrolled. It was a debugging aid left over from the 2.7.3 profile fix; nothing else changes.

---

## [2.7.3] - 2026-08-20

### Fixed

- **Profile export works again in Auto and Super**: the **Profile** tab's first step light stayed red however often you reloaded the profile page, so a profile export could never start — X renamed the request that loads a profile's posts, and XClipper was still watching for the old name. Both names are now recognized, so the light turns green the way it always did for Bookmarks and Likes. Bookmarks and Likes were never affected. (#107)

---

## [2.7.2] - 2026-08-15

### Added

- **Open Likes button jumps straight to your liked posts**: the batch export **Likes** tab used to grey its button out whenever you weren't already on a Likes page, leaving you to go find the page yourself — it had no fixed address to send you to. Your own likes now sit at a fixed address under X's History hub, so the tab offers a working **Open Likes** button, the way Bookmarks and Timeline already did. The label is English for now in every language, until it's translated.

### Changed

- **Auto and Super no longer wash the popup in red**: choosing one of the session-based engines used to turn the engine segment *and* the active source icon solid red, which read as an alarm rather than a mode. Both now use the same blue as every other selected control, and the "this runs through your logged-in X session" signal moved to the small ⓘ beside the explanation — red, and shown only for Auto and Super.

### Fixed

- **Bookmarks and Likes batch export follow X's new History address**: X is moving Bookmarks and Likes under a single History hub — `x.com/i/history` and `x.com/i/history/likes` — and batch export didn't recognize either page, so the Bookmarks and Likes tabs found nothing to collect and **Open Bookmarks** led to the old address. Both new addresses now work, alongside the old `/i/bookmarks` and `/<handle>/likes` for accounts the rollout hasn't reached.

---

## [2.7.1] - 2026-08-02

### Added

- **Filename template placeholders now autocomplete as you type**: typing `{` in Settings → Filename template opens a filtered list of the available placeholders (`{date}`, `{datetime}`, `{handle}`, `{author}`, `{id}`, `{slug}`, `{type}`) — Arrow keys move, Enter, Tab or a click inserts the full `{name}`. Same typeahead the Obsidian **Tags** field already had. (#55)

### Fixed

- **Tables in X Articles now export as tables**: an article table used to collapse into one unreadable run of concatenated cells (`LoopYou hand offUse it when…`). It now exports as a proper Markdown table — header row, columns and all — and as a real bordered table in PDF. Cells keep their bold, italic and links; a literal `|` is escaped and a line break inside a cell becomes a space so the row survives.
- **Fast Batch no longer drops code blocks and tables from articles**: in Auto and Super mode, every code block and table in an X Article was silently missing from the export — X sends those two as raw markdown rather than as structured content, and they were skipped. Both now come through, matching a normal export.
- **Bold and italic no longer break when the author styled a trailing space**: X Article authors routinely bold a label together with the space after it, which produced `**Best used for: **Shorter tasks` — markdown ignores a closing `**` that follows whitespace, so the asterisks showed up literally instead of rendering bold. The space now moves outside the markers (`**Best used for:** Shorter tasks`). Same fix for italic, for both the normal and Fast Batch export paths. (Originally fixed in 1.2.0 and lost in the Content AST rewrite.)
- **Fast Batch headings no longer come out bold**: X's article editor marks every heading's text bold, so Auto and Super exported `## **Getting started**` — asterisks around a line the `##` already makes a heading. The wrapper is dropped; bold on *part* of a heading is the author's own emphasis and stays.
- **Fast Batch image links now match a normal export**: Auto and Super wrote the canonical image URL (`…/HMkRVmsaEAA3Dl5.jpg`) while a normal export wrote the sized variant (`…?format=jpg&name=large`), so the same post exported two ways produced two different files. Both now use the sized form.
- **Stray asterisks from empty bold runs removed**: X ends some article paragraphs with a bold zero-width joiner, which exported as a bare `****` — four asterisks with nothing visible between them. Emphasis that contains nothing but invisible characters now renders without the markers.

---

## [2.7.0] - 2026-07-14

### Added

- **Zip files option packs a batch into a single download**: a new toggle next to the batch Output selector packs every per-post file into one `.zip` — one entry on Chrome's downloads shelf instead of one per post, which matters when Auto/Super saves thousands at once. Works with Separate and Both output for every format (the combined file and `data.json` stay separate downloads); rate-limited stubs keep their `_incomplete_rerun_to_complete/` folder inside the archive. The toggle greys out with Combined output, and while **Save images locally** is on — image bytes can't be fetched into the archive, so loose files remain the way to get local images.
- **Download-flood warning under the batch engine selector**: with Auto or Super selected while the export would still write loose per-post files (Zip off and Output not Combined), a highlighted hint now appears below the Manual · Auto · Super selector recommending the Zip toggle or Combined output, so a thousands-of-download-popups run doesn't come as a surprise. It disappears as soon as either is active.

### Fixed

- **Super mode's Expanding step no longer dimmed**: the step light was greyed out on the assumption that Super skips the whole expansion phase, but Super still fetches full X Article bodies (and completes earlier rate-limited items) — only threads are skipped. The step now stays live, and the run's phase text says "Expanding articles…" in Super instead of Auto's "Expanding threads & articles…".

---

## [2.6.1] - 2026-07-13

### Changed

- **Store listing reworded to satisfy Chrome Web Store metadata policy**: the one-line extension summary no longer repeats the formats already named in the title and now leads with likes, profiles, and long-form articles; no functional changes.

---

## [2.6.0] - 2026-07-12

### Added

- **Super Fast mode exports a whole feed in one or two runs**: an opt-in Fast Batch toggle that skips per-post thread expansion — the step that trips X's rate limit and caps a normal run at ~150 posts — raising the per-run budget to ~3000 posts. Threads export as their first post only; quotes, media, polls and long-post text still come through, and X Articles are still fetched in full. Posts exported this way count as done, so use **Reset history** to re-export them with full threads later.
- **Fast Batch fetch modes — Recent / Resume / Date range**: a mode switch for Fast Batch. *Recent* starts from the top of your feed (newly-added items). *Resume* continues from where the last Resume run stopped, so a large feed (thousands of bookmarks) is backfilled across sessions instead of re-scanning already-exported items from the top each run — and switching to Resume after several Recent rounds pages straight past everything Recent already exported to reach fresh posts in one run. *Date range* (its inputs appear only when selected) exports only posts tweeted within a chosen window; it scans deep from the top and **continues across runs** on its own cursor (so even a very large feed is covered in a few runs), skipping what you've already exported but deliberately **not** moving the Resume position — so you can grab a specific month mid-backfill without losing your place. All three share one export history; **Reset history** clears it and both cursors.

### Changed

- **Single export unified into a format picker with Download and Copy**: instead of a Markdown-only Download/Copy pair plus a separate download-only row for the other formats, single export now has one picker — `.md` in the center with `.html`, `.json`, `.txt` and `.csv` around it — and a Download and a Copy button that act on whichever format is selected. Copy now works for every format (previously Markdown only), and your selected format is remembered between sessions. Export .pdf and Add to Obsidian are unchanged.
- **Batch engine picked with one Manual · Auto · Super selector**: the export engine is now chosen from a single segmented control with an always-on caption explaining each — instead of separate Fast Batch and Super Fast on/off toggles. *Manual* is the standard page-scroll export (works on every source). *Auto* and *Super* fetch through your logged-in X session (no API key, nothing leaves your browser) and cover Bookmarks / Profile / Likes; picking one greys the tabs it can't do. *Super* trades full threads for volume. The caption spells out the scroll-mode and quality trade-off, so the old info tooltips are gone.
- **Super Fast streams downloads while it fetches**: in Super Fast mode (separate-files output), each post is now saved the moment the feed returns it, overlapping its download with the rest of the crawl, instead of collecting the whole feed and then firing every download in one burst at the end. The download load spreads across the run — so Chrome's downloads bar trickles rather than machine-gunning a few thousand files at once — and the export finishes a little sooner. Runs with thread expansion, articles, or combined output are unchanged.
- **Fast Batch progress drops the fill bar for a live count**: Fast and Super Fast runs no longer show a progress bar — it could only fake a fraction, since collection is open-ended and Super Fast streams writes in parallel with no known total. The running count (posts fetched / skipped, then files written), the step lights, and the Stop button stay. Standard Batch keeps its bar, where the total is known upfront and writes are sequential.
- **Fast Batch completes earlier items by ID**: posts a previous rate-limited run left incomplete are now finished with a direct fetch by their id at the start of the next run — independent of where the feed is paginated — so they complete in either Recent or Resume mode instead of relying on re-encountering them in the feed.
- **Fast Batch runs sized to the expansion budget**: a Fast Batch run now collects 150 posts (down from 200) to match how many thread/article expansions X allows before rate-limiting — so a run finishes everything it collects instead of leaving ~50 behind each time, which otherwise piled up run after run. Standard Batch is unchanged.

### Fixed

- **Export settings remembers whether you folded it, per mode**: the Export settings group now stays collapsed or expanded the way you last left it in Single and in Batch, instead of snapping back to expanded-in-Single / collapsed-in-Batch every time you switch modes or reopen the popup. Those remain the defaults on a fresh install; your own fold just sticks now.
- **Chrome stays responsive while a batch writes thousands of files**: batch downloads were all fired at once, so a large export (e.g. a Super Fast run) janked the whole browser — downloads UI, history and disk writes all landed together — until the queue drained. Writes now keep at most 8 downloads in flight so disk speed sets the pace: the write phase takes a little longer, but Chrome stays usable and the progress bar tracks files actually written.
- **Reset buttons no longer flicker after a large export**: the popup refreshed the Reset queue / Reset history buttons by greying them first and re-enabling after an async storage read; right after a big export — while Chrome is still writing hundreds of downloaded files — that read is slow enough for the greyed state to paint every second, so the buttons blinked until the writes drained. Each refresh now assigns the buttons their final state exactly once.
- **Fast Batch no longer re-exports edited or re-rooted posts every run**: some posts (edited tweets, and thread replies that re-root to the thread's first tweet on expansion) end up with a different canonical id than the one the bookmarks feed lists, so the dedup history — which only stored the canonical id — never matched them again and they re-exported on every run. Fast Batch now remembers both ids, so these posts are correctly skipped once exported.

---

## [2.5.1] - 2026-07-11

### Fixed

- **Fast Batch separates incomplete exports**: when X rate-limits a run mid-expansion, posts whose thread or article couldn't be fully fetched are now saved into an `_incomplete_rerun_to_complete/` subfolder — and kept out of the combined file and `data.json` — instead of sitting alongside complete exports where you couldn't tell them apart. They stay un-tracked so re-running Fast Batch a few minutes later completes them.
- **Fast Batch retries incomplete posts first**: the next run now expands the posts a previous rate-limited run left incomplete before any fresh ones, so the stable bookmark order can't keep postponing the same tail of posts run after run.

---

## [2.5.0] - 2026-06-17

### Added

- **Firefox extension build**: added a Firefox MV3 build target and package command (`npm run build:firefox`, `npm run package:firefox`) that emits `dist-firefox/` with a Gecko-compatible manifest, background script fallback, and native toolbar theme icons.

---

## [2.4.0] - 2026-06-15

### Added

- **Fast Batch step lights**: a small Page → Tweet → Fetch → Expand indicator shows, before you export, whether the page's feed and a tweet have been captured (green/red), then lights up the live phase during a run — so you know what (if anything) to do first.
- **Include reposts toggle**: by default a profile batch exports only the owner's own posts (both Standard and Fast); turn this on to include their reposts too.
- **Date-range filter for Fast Batch**: limit an export to posts within a date range (e.g. a single month). Out-of-range posts are skipped without being fetched in full, so you spend X's per-session quota only on the posts you want and can reach older ones without getting rate-limited.
- **Fast Batch now works on Profiles and Likes**: not just Bookmarks — export a profile's own posts (reposts skipped) or your liked posts through your X session at the same ~10× speed. Selection stays Standard-only (its tab is disabled while Fast is on).
- **Reset queue**: empties the posts gathered so far and restarts collecting from wherever you've scrolled to, so you can begin a batch at a specific post instead of always from the top.
- **Timeline batch source**: a new **Timeline** tab exports the posts loaded in your home feed (`x.com/home`), the same way Bookmarks/Profile/Likes do. Standard only — its tab is disabled while Fast is on (the home feed isn't paginated the way Fast needs).
- **More right-click export formats**: the X right-click menu can now export a single post directly as **txt**, **HTML**, **JSON**, or **CSV** (download), plus **Copy tweet as txt** to put plain text on the clipboard — the same formats as the popup, without opening it.

### Changed

- **Right-click menu reorganized**: three groups — PDF / Obsidian, the Markdown actions, then the other file formats — and renamed **Save tweet as PDF → Export tweet as PDF** and **Save tweet as Markdown → Download tweet as Markdown**.
- **Open Bookmarks / Timeline from their tab when off-page**: When you're not on the right page, the **Bookmarks** and **Timeline** tabs now show an **Open Bookmarks / Open Timeline** button that takes you there (instead of a disabled button) — then scroll and export.

---

## [2.3.0] - 2026-06-14

### Added

- **Fast Batch (beta)**: an opt-in second batch mode that exports your **bookmarks** far faster by fetching them directly through your already-logged-in X session instead of opening and rendering each post in a tab. It expands self-threads and full X Articles, and is careful with your account: it spreads requests out and **stops politely if X rate-limits you** (re-run a few minutes later and it picks up only what's left). Standard Batch stays the default and is unchanged — Fast Batch is off until you flip the red toggle, which asks for a one-time, X.com-only permission. Nothing leaves your browser: no API keys, no server, no password. (Bookmarks only for now.)

### Changed

- **Faster batch export**: the politeness gap between posts dropped from 2–4 s to ~0.6–1.2 s, and the per-post thread/media hydration now settles adaptively — it proceeds the instant content mounts instead of always waiting a fixed delay, while keeping the same upper bound so slow-loading threads are never truncated. Together these noticeably cut batch wall-clock. To keep the tighter pace safe, a batch now **auto-pauses** when it hits a login or rate-limit wall, or after several failures in a row — the popup shows why, and Resume picks up where it left off.

---

## [2.2.0] - 2026-06-13

### Added

- **Likes as a batch source**: export the posts you've liked from your Likes page — the fourth batch source alongside Bookmarks, Profile, and Selection.
- **Batch export formats**: batch jobs can now be saved as **Markdown**, **HTML**, **JSON**, **TXT**, or **CSV** (PDF isn't batchable), chosen from a **Format** dropdown in the batch Export settings.
- **More single-export formats** (issue #54): alongside Markdown and PDF, a single post can now be saved as **HTML** (a styled, self-contained file), **JSON** (the raw structured document), **TXT** (plain text, markup stripped), or **CSV** (your selected Default/Obsidian frontmatter fields as columns, plus a `text` column with the post body). The buttons live under a collapsible **More formats** row in the popup.
- **Web Store review prompt**: after 30 exports (files, not Copy), the popup shows a one-time, dismissible banner inviting a Chrome Web Store review. "Maybe later" snoozes it once; "Rate" or dismissing it never shows it again.

### Changed

- **Batch output — Separate / Both / Combined**: a tri-state control replaces the old "Export also as one file" toggle — write per-post files, a single combined file, or both. CSV is always one combined file (one row per post).
- **Batch source tabs are now icons**: Bookmarks, Profile, Likes, and Selection each show their icon (name on hover) so all four fit the strip cleanly.
- **Batch export marked Beta** in the popup while it's still being tuned.
- **Settings adapt to the chosen batch format**: in Batch mode, options a format can't use are greyed out (Save images / engagement stats for CSV/TXT/JSON). And **CSV now honors Include metadata** — with it off, CSV keeps only the `date`, source URL, and post `text` columns (mirroring the Markdown footer), instead of always emitting the full frontmatter columns.

### Fixed

- **Toolbar icon in dark mode**: the toolbar icon now switches to a light-slash variant when the OS is in dark mode, so it no longer disappears against a dark Chrome toolbar.

---

## [2.1.0] - 2026-06-12

### Added

- **Batch export**: Export many posts at once from three sources, picked via a **Bookmarks | Profile | Selection** tab strip in the popup — your Bookmarks page, a profile's own posts (reposts skipped), or a manual **Selection** of individual tweets ticked with checkboxes on any x.com timeline. The job runs in the background, one at a time, so the popup can be closed and reopened without losing progress; a live progress bar offers **pause / resume / stop**. A dedup ledger remembers what was already exported, so re-running a batch only grabs new items — **Reset dedup** clears that memory. An optional **Export also as one file** digest additionally writes every exported post into a single `x-compilation-<date>` file in the batch folder.
- **Add to a running batch**: While a job runs, scrolling the page in more posts now lets you append them to that job's queue (same source only) instead of waiting for it to finish or stopping and restarting.

### Changed

- **Popup split into Single / Batch tabs**: Reorganized into a **Single export | Batch export** tabbed layout, with player-style batch controls (pause/resume/stop in front of the progress bar) and a clearer Export settings panel.
- **Selection bar made easier to spot**: Larger and easier to spot, with a slide-up entrance and a "Tap tweets to select" hint.

---

## [2.0.4] - 2026-06-11

### Changed

- **Relicensed to PolyForm Noncommercial**: Relicensed from MIT to the [PolyForm Noncommercial License 1.0.0](LICENSE) — free for noncommercial use, paid license required for commercial use; contributor terms updated to match. Forward-only: prior releases remain under MIT.
- **Internal restructuring (no behavior change)**: Consolidated the user-settings shape into a single shared module so the popup, content script, and PDF flow can no longer drift apart, split the popup script into focused modules (DOM references, settings view, export actions, reusable widgets), and split the DOM→AST extractor into per-concern modules (inline, cards, media, poll, quote, tweet, article). Reduces the chance of regressions when adding a setting or an export target. Also enabled stricter TypeScript checks (`noUnusedLocals` / `noUnusedParameters`).

### Fixed

- **Frontmatter field selection in inline-button, context-menu, and PDF exports**: These flows now apply the same default-merged frontmatter field map as the popup, so a partial field selection saved by an older version no longer drops newly-added fields. Default selections are unaffected.

---

## [2.0.3] - 2026-06-07

### Added

- **Date in Article PDF exports**: Formatted publication date next to the author handle in the article byline.

### Changed

- **PDF action renamed to "Export .pdf"**: Rename the popup action from **Download .pdf** to **Export .pdf** and add a tooltip that describes the generated PDF export flow.

### Fixed

- **Article PDF engagement stats overwrite fixed**:
  - Forward PDF rendering options to the article layout renderer and conditionally render engagement metrics below the title/banner when enabled.
  - Fix an issue where the redundant `options.includeMetadata` override in `extract()` caused engagement stats to be overwritten with `undefined`.
  - Add test coverage for the article engagement rendering toggle.
- **Captioned X Article images restored after AST refactor**: Restore Markdown image extraction for X Article media blocks that include captions, preventing `/article/.../media/...` links from replacing the underlying `pbs.twimg.com` image URLs.
- **Embedded tweets in X Articles preserved**: Preserve `simpleTweet` embeds as quoted tweet cards with author, text, and media instead of collapsing them to avatar images. (#50)

---

## [2.0.2] - 2026-06-06

### Fixed

- **PDF Export respect Engagement toggle** (#46): Engagement metrics are now stripped from the PDF export when the *Engagement* toggle is turned off.
- **Thread engagement stats repositioned** (#47): For threads, the engagement stats line in Markdown is now placed right after the first tweet (before the separator) instead of after the last tweet.

---

## [2.0.1] - 2026-06-05

### Fixed

- **Tooltip opacity on disabled options** (#38): Decoupled the opacity styles so that tooltips on disabled / greyed-out options (like *Inline button copies instead*) remain fully opaque and readable.

---

## [2.0.0] - 2026-06-05

### Changed

- **Rebrand to XClipper**: The extension is renamed from *tweet2md* to *XClipper* across the toolbar icon, popup wordmark, context-menu label, and Chrome Web Store listing. The new icon — a paperclip with a stylized X — replaces the markdown-arrow logo. Chrome Web Store titles across all 12 locales now lead with "X / Twitter Web Clipper" plus each locale's natural save verb, the PDF format, and a "Free, no API" trust signal.
- **Inline button defaults to off for new installs**: New installs no longer inject the per-tweet action-bar download button by default, reducing the chance of layout conflicts with other X extensions. Existing v1.9.0 users keep their stored choice; flip it in Settings → *Show inline button on tweets*.

### Changed

- **Settings carry over automatically from v1.9.0**: Preferences saved under the previous `tweet2md_settings` storage key are copied to the new `xclipper_settings` key on first run after the update. Subfolder, filename template, Obsidian vault, frontmatter selections, and every toggle state come across transparently — no reconfiguration needed.

---

## [1.9.0] - 2026-06-04

### Added

- **Content AST Architecture**: Refactored the core extraction pipeline from a direct DOM-to-Markdown translation (via Turndown) to a typed, JSON-serializable Content AST (Abstract Syntax Tree) as the single source of truth (`DOM → AST → MD/PDF`). This decouples content parsing from rendering, enabling clean support for multiple formats (Markdown, PDF) and preserving complex, platform-specific semantics like nested quote-tweets, polls, link cards, and threads.
- **PDF export**: New **Download .pdf** button next to **Add to Obsidian**. Opens a print-preview tab where you save the tweet / thread / article as a PDF via the browser's native print dialog. Text is selectable, links are clickable, and emoji and non-ASCII glyphs render correctly.
- **X Article quote cards**: Tweets that quote one of X's long-form Articles now appear as `📝` card blocks (banner + title + description) in Markdown and PDF.

### Changed

- **Popup: PDF + Obsidian share a row**: **Download .pdf** and **Add to Obsidian** share one row at full label width across all locales.

### Fixed

- **Thread engagement stats from the wrong tweet** (#40): Stats now correctly reflect the first tweet of the thread.
- **Frontmatter field picker in RTL locales**: YAML keys (`author`, `created`, …) are code identifiers — they now stay LTR for readability. Toggle on/off direction is also unified everywhere (ON = right) regardless of text direction.

---

## [1.8.0] - 2026-06-02

### Added

- **Customizable tags in Obsidian-friendly frontmatter**: New **Tags** field in Settings → Obsidian (comma-separated, supports the same placeholders as the filename template). Type `{` to open a placeholder autocomplete; a **Reset** button restores the default `clippings, x, {type}`. The field greys out when Obsidian-friendly frontmatter or the `tags` YAML entry is disabled. (#35)

### Changed

- **Obsidian row redesign**: The *Add to Obsidian* button no longer shares its row with a hint paragraph that clipped its label in some locales (e.g. German, Russian). The button is centered at ~62.5% width and the hint moved into a ⓘ tooltip on the right. The tooltip now also nudges toward Settings: *Configure vault, subfolder, and frontmatter fields in Settings. Use the 'Download .md' button for long threads or images.* Translated across all 12 locales. (#33)
- **"Download .md" hint wording**: The reference to the Download button is now wrapped in quotes — single quotes for most languages, 「…」 for ja and zh_CN — so it's unambiguously read as a button label, not a separate tool. pt_BR / hi / ja hints also realigned to match their actual button labels. (#33)
- **"Activate all" button no longer wraps**: More horizontal padding and `nowrap` so the label has room and never wraps in long-translation locales. (#33)

### Fixed

- **Right-to-left layout (Arabic, Persian)**: The popup now sets `<html dir>` and `<html lang>` from the active UI locale, so bidi text (e.g. *Markdown* in an Arabic sentence) flows in the correct position. Layout, gear icon, footer version, tooltips, and toggle knobs all mirror via CSS logical properties. (#34)

## [1.7.0] - 2026-05-30

### Added

- **Single-Tweet Export**: New **Copy just this tweet (no thread)** context-menu item, plus Shift- or Alt-clicking the inline button, exports only the focused tweet instead of the whole thread. Default behaviour is unchanged.
- **Three new UI languages**: Hindi, Italian, and Russian — bringing the popup UI to 12 supported locales.
- **Footer version link**: The popup footer version (e.g. `v1.7.0`) now links to this changelog on GitHub.

### Fixed

- **Polls now captured**: Tweet polls are now captured — choices, result percentages once voted, and the vote total/status line. Previously they were dropped entirely. (#28)
- **Translation gaps filled**: Corrected a stale tooltip in 7 locales (the **Close the tab after export** option still described old behaviour), filled in 5 Frontmatter fields strings missing since 1.6.1 across the existing non-English locales, and polished hi/it/ru/fr wording per native review.
- **Thread completeness on deep-link permalinks**: Opening a mid-thread reply (e.g. the 10th tweet in a chain) now walks up to the thread root before exporting, so all parent tweets are captured. Tombstone articles (deleted or hidden parents) are skipped instead of terminating the walk. (#22)

## [1.6.1] - 2026-05-21

### Added

- **Filename Template**: New **Downloads** setting with placeholders (`{date}`, `{datetime}`, `{handle}`, `{author}`, `{id}`, `{slug}`, `{type}`) and a live preview in Settings. Filesystem-invalid characters are stripped; capped at 120 chars. Leave blank to keep the previous defaults. (#24)
- **Frontmatter Field Picker**: New **Frontmatter fields** section in Settings — per-field toggles to include/omit each YAML entry. Selections are saved separately for the default and Obsidian-friendly schemas, with an **Activate all** button per mode. The picker greys out when **Include metadata** is off, and the two toggles auto-keep each other in sync. (#25)
- **Version in Footer**: Popup footer shows the installed extension version (e.g. `v1.6.1`) so it's obvious what build is running.

### Changed

- **Collapsible Settings Sections**: The four Settings groups are now each collapsible, with Downloads + Obsidian open by default and a cap of two expanded at once. Opening Frontmatter fields auto-opens Obsidian (whose toggle picks the Frontmatter mode); the last layout is persisted.
- **Settings hint moved to a tooltip**: The "Hover over labels for more info" hint moved to a small ⓘ tooltip icon top-right so long translations don't crowd the topbar. The popup footer is hidden in the Settings view.
- **Instant CSS Tooltips**: All label/button tooltips migrated from native `title=` to a unified CSS pattern that stays inside the popup window, with consistent 500ms-delay behaviour.
- **Toolbar icon background made transparent**: Icons (16/32/48/128) now have a transparent background — no white square frame in dark mode. Rim cleaned via color-to-alpha so there's no antialiasing halo either.

## [1.6.0] - 2026-05-18

### Added

- **Downloads Subfolder**: New **Downloads** setting that places exported Markdown and images inside a subfolder of your Downloads folder. Leave blank for the previous behaviour. (#17)
- **Obsidian Vault Subfolder**: New **Obsidian** setting that creates the note inside a vault subfolder (e.g. `Tweets` or `Inbox/Tweets`). Leave blank to keep notes at the vault root. (#18)

### Changed

- **Extension renamed for Web Store search**: Renamed to *X Threads Articles to Markdown or Obsidian* across all 9 locales for better Chrome Web Store search match. `short_name` remains `tweet2md`.

### Fixed

- **Obsidian handoff vs. close-after-export**: The new-tab auto-close used to fire before Chrome's "Open Obsidian.app?" prompt and dropped the handoff. The auto-close now skips the Obsidian action; download/copy still respect it. (#16)

## [1.5.1] - 2026-05-16

### Security

- **Hostname Sanitization**: Replaced substring-based host checks with a `hostMatches` helper that compares parsed hostnames exactly. Closes 9 CodeQL `js/incomplete-url-substring-sanitization` alerts and tightens the popup's x.com gate.

### Changed

- **Extension description now mentions Obsidian**: The Web Store description now mentions the Obsidian handoff. Updated across all 9 locales.

## [1.5.0] - 2026-05-15

### Added

- **Add to Obsidian**: One-click handoff via the `obsidian://new` URI scheme with the rendered Markdown prefilled. Local — no network call. Forces Obsidian-friendly frontmatter; images stay as remote URLs.
- **Obsidian-friendly Frontmatter**: Optional export schema with wikilinked author handles (`[[@username]]`), synthesized title, `published`/`created` dates, prose `description`, and `tags: [clippings, x, <type>]`. Toggle off = identical to the previous schema.
- **Obsidian Vault Setting**: Optional vault name in Settings; included in the deeplink so notes land in a specific vault. Blank = Obsidian picks the last-used vault.
- **Link cards now captured**: External link previews in tweets are now captured (title, source domain, Open Graph image — kept as a remote URL).
- **Multi-View Popup**: A gear icon at the top-right slides over to a dedicated settings view, separating per-export controls from set-once configuration.

### Changed

- **Grouped Settings**: Inline-button / context-menu toggles and Obsidian settings moved into the settings view; the main view focuses on Download / Copy / Add to Obsidian and per-export toggles.
- **Popup layout reorganized**: Download/Copy split into a half-width grid on top, Export options card below, and a half-width Obsidian button paired with its hint paragraph.

## [1.4.1] - 2026-05-12

### Added

- **Promoted Tweet Skipping**: Thread extraction recognises locale-aware "Ad" / "Promoted" labels and skips them, so a mid-thread ad no longer cuts collection short. (thanks @BigCactusLabs, #7)
- **K/M/B Engagement Counts**: Compact metrics like `1.5K likes` or `2M views` are now parsed instead of dropped. (thanks @BigCactusLabs, #7)

### Changed

- **Quoted-Tweet Media Order**: A tweet's own media now renders before the quoted block, matching X's visual order. Quoted media stays nested inside the blockquote.

### Fixed

- **Duplicate Video Poster**: Deduplicated cases where X hydrated both a poster `<img>` and a `<video>` for the same clip. (thanks @BigCactusLabs, #7)

### Changed

- **Contributing Guide**: Added `CONTRIBUTING.md` covering snapshot-test discipline and fixture capture.
- **CI Pipeline**: GitHub Actions CI for tests and build. (thanks @BigCactusLabs, #8)

## [1.4.0] - 2026-05-11

### Added

- **In-Place Extraction**: Triggering the inline button or context menu on a tweet's permalink page now extracts in the current tab instead of opening a duplicate. The auto-close toggle never closes your active tab.
- **In-Page Toast**: Brief top-center *Copied!* / *Downloaded!* confirmation for in-place extractions, localized in all 9 languages.
- **Show Inline Button toggle**: Hide the inline icon if it conflicts visually with another extension. Takes effect live, no reload.
- **Show Engagement Stats Inline toggle**: Optional X-style stats row in the Markdown (`💬 284 · 🔁 1.5K · ❤️ 8K · 🔖 253 · 👁 100K`), independent of YAML frontmatter.
- **Grouped Settings**: Popup options split into *Export* and *Inline button & context menu* sections so 6 toggles stay scannable.

### Security

- **Download Sender Validation**: Background download handler now validates message sender — only x.com content scripts and trusted extension pages can trigger downloads. (contributed by [@BigCactusLabs], #6)
- **Image Host Allowlist**: Local image downloads restricted to known X media hosts; everything else stays as remote Markdown links.
- **Path Sanitization**: Filename/path sanitization strengthened — drops `..` and absolute paths, normalizes unicode before download.

### Changed

- **Inline Button Visual Match**: Icon redesigned with X's solid-fill style and now mirrors the sibling action-bar icon's exact size and color across every X surface (timeline, focused tweet, light, dark).
- **Cleaner Context Menu**: Save / Copy items nest under an explicit "tweet2md" parent label instead of Chrome's auto-grouped full extension name.
- **Toast Position**: Top-center with a 2-second hold so it's harder to miss.
- **"Close tab" wording clarified**: "Close tab after export" → "Close the new tab after export" — clearer that only the tweet2md-opened tab closes.
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

- **contextMenus permission added**: New `contextMenus` permission for the right-click menu. No data collection, telemetry, or network calls — see [PRIVACY.md](PRIVACY.md).
- **Localization for new settings & menu**: Translations for the new settings and context-menu items added across all 9 languages.

## [1.2.1] - 2026-04-19

### Added

- **Web Store Assets**: Added promotional web store assets to the project repository.

### Changed

- **Popup hint relocated to header**: Relocated the instruction hint to the header and updated the footer to include a direct link to the GitHub repository for issues and suggestions.
- **Localization polished across 9 languages**: Polished translations across 9 supported languages to ensure better native phrasing.
- **Manifest metadata updated**: Updated extension metadata and localized descriptions for Web Store consistency.

## [1.2.0] - 2026-04-01

### Added

- **Copy to Clipboard**: Added a "Copy .md" button to the popup to copy generated markdown directly to your clipboard instead of downloading.
- **Multi-Language UI**: Popup interface now available in 9 languages — English, Spanish, German, French, Japanese, Portuguese (Brazil), Chinese (Simplified), Arabic, and Persian. The UI automatically matches your browser's language. Content extraction works on any language regardless of UI translation.
- **Dynamic Theming**: Added light and dark mode support to the popup UI, automatically respecting your system preferences.

### Fixed

- **Markdown bold/italic whitespace fix**: Fixed a bug causing improper bold and italic rendering when text nodes contained trailing or leading whitespaces.

## [1.1.0] - 2026-03-22

### Added

- **Local Image Downloads**: Added a popup option to download all attached images locally into a subfolder next to the markdown file. The generated markdown automatically updates `![alt]` tags to reference the new local paths.
- **Tweet Metadata**: Added a toggle to include engagement metrics (likes, reposts, replies, bookmarks, views) as YAML frontmatter at the top of the generated markdown file.
- **Settings Persistence**: Popup toggles now remember your preferences between sessions.

### Changed

- **Quote Tweet Extraction**: Refined extraction logic to accurately differentiate between main tweet text and quoted tweet text, preventing messy or duplicated text in the output.
- **Popup toggle switches**: Replaced basic checkboxes with modern, animated toggle switches with SVGs.
- **Path Sanitization**: Better handling of invalid characters in generated markdown and image filenames.

## [1.0.0] - 2026-02-15

### Added

- **Core Extraction**: Tweets, threads, and X Articles/Notes.
- **DOM Cleaning**: Strips follow buttons, engagement bars, and unwanted navigation automatically.
- **Markdown Conversion**: Turndown.js integration with custom rules for inline links, emojis, and @mentions.
