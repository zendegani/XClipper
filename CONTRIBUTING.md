# Contributing to XClipper

Thanks for your interest. This file captures the working conventions for the project — read it before opening a PR.

## Contribution terms

XClipper is **source-available** under the [PolyForm Noncommercial License](LICENSE), and the maintainer also offers separate **commercial licenses**. By submitting a contribution (a pull request, patch, or any other work), you agree to the following — it's short and it matters:

1. **You have the right to contribute it.** The contribution is your own original work, or you otherwise have the right to submit it, and to your knowledge it does not infringe anyone else's rights.
2. **You grant the maintainer a broad license.** You grant Ali Zendegani (the project's copyright holder) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, distribute, sublicense, and **relicense** your contribution, in whole or in part, under **any terms** — including the project's PolyForm Noncommercial license **and** any commercial or proprietary license the maintainer grants or sells.
3. **No compensation.** Your contribution is voluntary. You are not entitled to any payment, royalty, or revenue share for it, including when it ships in a commercially licensed version of XClipper.
4. **You keep your copyright.** You retain ownership of your contribution; this grants the maintainer a license, not a transfer of ownership.

If you can't agree to these terms, please don't submit a contribution — open an issue to discuss instead.

## Philosophy

- **Smallest change that solves the problem.** Five-line fixes beat five-hundred-line ones. Refactors are welcome but kept separate from feature or bug-fix changes.
- **One concern per PR.** If a single PR description needs the word "also" to summarize it, it's probably two PRs.
- **Behavior changes require deliberate consent.** Any change that alters what an existing user sees in their exported Markdown is a behavior change, not an "improvement we ship by default."

## Local development

```bash
npm install
npm run build       # production build → dist/
npm run watch       # rebuild on save + sourcemaps
npm test            # vitest snapshot tests
npm run package     # build + zip for Chrome Web Store
```

Load `dist/` as an unpacked extension in `chrome://extensions/` (Developer mode → Load unpacked).

## Snapshot tests

`tests/extractor.test.ts` runs the extractor against captured HTML fixtures in `tests/fixtures/*.html` and compares the produced Markdown to `tests/fixtures/*.md`. Volatile YAML fields (`date`, `likes`, `reposts`, `replies`, `bookmarks`, `views`) are normalized to `<ignored>` before comparison; everything else is compared byte-for-byte.

**If your change alters extractor output:**

1. Run `npm test` to see which fixtures break and what the diff is.
2. Decide whether each diff is intentional. Often it isn't — fix the code instead of the fixture.
3. For every intentional change, update the corresponding `.md` fixture in the same commit and explain why in the PR.

A failing fixture is a signal, not a chore to silence. "Just update the snapshot" without understanding why it changed is the most common way regressions slip in.

## Capturing fixtures

Fixtures live in `tests/fixtures/`. The `.html` files are gitignored — they're large and may contain session-specific data — while the `.md` files are committed and act as the snapshot.

To add a new fixture:

1. **Log in to X.** A logged-in session is needed because X shows only the first tweet of a thread to anonymous visitors. A dedicated test account is fine.
2. **Navigate to the tweet, thread, or article permalink.**
3. **Scroll to the focused tweet and wait a few seconds.** Videos must hydrate, images must load, lazy embeds must expand. A premature capture catches the page mid-render and produces flaky fixtures (for example, a video poster `<img>` may appear in the DOM before the real `<video>` element replaces it).
4. **In DevTools console, run:**
   ```js
   copy(document.documentElement.outerHTML)
   ```
5. **Save to `tests/fixtures/<handle>-<tweetId>.html`** — the test loader matches fixtures by this filename pattern.
6. **Run the extension on the same page** and save the produced Markdown to `tests/fixtures/<handle>-<tweetId>.md`.
7. **Inspect the `.md`** to confirm it doesn't include anything you'd rather not commit publicly.
8. **Run `npm test`** to confirm the new fixture passes.

Both files go in the same commit (the `.html` is gitignored but is still useful locally; the `.md` is the committed snapshot).

## Extractor scope

The extension recognizes three content types:

- **Single tweet** (`type: tweet`): the focused status only.
- **Thread** (`type: thread`): a single-author chain. Collection starts at the focused tweet, walks subsequent same-author posts down the page, and stops at the first post by a different author (the reply boundary). The extractor does not follow conversation links or pull in replies.
- **Article** (`type: article`): an X long-form Article ("Note"), with structured headings, lists, and code blocks.

Widening any of these scopes (for example, including replies in a thread) is a behavior change. Open an issue to discuss before sending a PR.

## Frontmatter

The YAML frontmatter at the top of the generated Markdown is part of what the user keeps in their notes. Treat each field there like product copy.

Suitable for frontmatter:
- Information the user wants to query, filter, or display (`author`, `handle`, `date`, `type`, engagement counts).

Not suitable for frontmatter:
- Diagnostic, telemetry, or debug fields (extraction step counts, internal stop reasons, timestamps). These belong in commit messages or console logs.
- Anything that requires reading the extension source code to understand.

## Code style

- TypeScript, ES modules. Match the surrounding file for formatting (semicolons, quotes, indentation).
- Prefer adding to an existing module over creating a new one, unless the new module has a clearly separable responsibility. The current split under `src/content/` (`dom`, `tweet`, `article`, `dom-to-ast/`, `wait`) and the renderers under `src/ast/` are the size we aim for.
- Comments explain *why*, not *what*. If well-named code is self-explanatory, leave it uncommented.
- Avoid abstractions for single-use code. Inline a one-call-site helper.

## Security and permissions

- Manifest permissions are minimal (`activeTab`, `contextMenus`, `downloads`, `storage`) and host-scoped to x.com. Adding a permission needs a concrete justification, an issue, and a PRIVACY.md update.
- No remote script loading, no remote runtime dependencies, no `eval` or string-based timers. MV3's default CSP enforces most of this anyway.
- The background's `DOWNLOAD_MD` listener validates message senders; don't bypass that check.

## When to open an issue before a PR

Open an issue first for any change that:

- Alters user-visible output (the Markdown a user sees in an exported `.md` file).
- Adds a manifest permission, a content-script match pattern, or a new dependency.
- Replaces an existing module rather than incrementally improving it.
- Adds or modifies localized strings.

For small bug fixes, typos, and tightening of existing code, a direct PR is fine.

## For developers

### How it works

- Content script auto-injects on `x.com/*/status/*` pages.
- DOM is parsed into a typed, JSON-serializable **Content AST** (the single source of truth); separate renderers turn it into Markdown or PDF — see [`docs/adr/0001`](docs/adr/0001-content-ast-architecture.md).
- **Tweets/threads:** custom AST rendering (t.co resolution, emoji inlining, @mention cleanup).
- **Articles:** manual Draft.js block parsing for precise heading/list/code-block extraction.
- **PDF:** the same AST renders to HTML and prints via Chrome's native engine.
- **Fast Batch (opt-in):** an alternate acquisition path maps X's internal GraphQL JSON to the same Content AST (`src/graphql/`), reusing every renderer and sink unchanged — see [`docs/adr/0003`](docs/adr/0003-fast-batch-graphql.md).
- DOM is cleaned (engagement bars, follow buttons, navigation) before extraction.
- Downloads go through the `chrome.downloads` API after the background worker validates the message sender and sanitizes paths. Local image downloads are limited to expected X media hosts; external image URLs stay as remote Markdown links.
- Nothing leaves your browser.

### Tech stack

- **TypeScript** + **esbuild** (content IIFE, background ESM)
- **Content AST** → custom Markdown / PDF renderers (no Turndown)
- **Manifest V3**

### Project structure

```text
xclipper/
├── src/
│   ├── content/        # DOM → Content AST (dom-to-ast/), inline button, PDF trigger
│   ├── ast/            # Content AST types + renderers (Markdown, PDF HTML)
│   ├── background/     # Service worker (downloads, context menu, PDF print, batch)
│   ├── popup/          # Popup UI, split: dom / settings-form / actions / widgets
│   ├── print/          # Print page for native PDF export
│   ├── shared/         # Cross-context logic (post-process, settings, media, obsidian)
│   ├── types/          # Shared TypeScript interfaces (messages)
│   ├── icons/          # Extension icons (16, 32, 48, 128px)
│   ├── _locales/       # i18n translations (en, es, de, fr, it, ja, pt_BR, ru, zh_CN, ar, fa, hi)
│   └── manifest.json   # Chrome MV3 manifest (Firefox variant is generated at build time)
├── dist/               # Chrome build output
├── dist-firefox/       # Firefox build output
├── docs/               # architecture.md overview + ADR + Content AST schema
├── tests/              # Vitest + JSDOM extractor/AST snapshot tests
├── build.mjs           # esbuild build script
├── package.json
└── tsconfig.json
```

### Development

```bash
npm install        # Install dependencies
npm run build      # Build for production
npm run build:firefox  # Build the Firefox MV3 variant
npm run watch      # Build + watch for changes
npm test           # Run extractor snapshot tests (Vitest + JSDOM)
npm run package    # Package for Chrome Web Store (.zip)
npm run package:firefox # Package for Firefox Add-ons (.zip)
npm run clean      # Clean build output
```

### Tests

`tests/extractor.test.ts` runs the extractor against saved HTML fixtures and compares output against versioned `.md` snapshots (volatile frontmatter fields like `likes` and `date` are normalized). HTML fixtures are gitignored — capture them locally via `copy(document.documentElement.outerHTML)` in DevTools after the page is fully loaded. If no local fixtures are present, the suite keeps a passing baseline so fresh checkouts can still run tests.

### Permissions

| Permission     | Why                                                  |
|----------------|------------------------------------------------------|
| `activeTab`    | Read the current page's DOM when you click           |
| `downloads`    | Save the `.md` file and allowed X media images to Downloads |
| `storage`      | Remember your popup toggle preferences and the optional Obsidian vault name |
| `contextMenus` | Add **Save / Copy tweet as Markdown** to the right-click menu (X.com only) |
| `alarms`       | Keep batch jobs running reliably while the service worker idles (a watchdog timer) |
| `offscreen`    | Chrome only: detect your OS light/dark setting to switch the toolbar icon. Firefox uses native `action.theme_icons` instead |
| `host` (X.com) | Inject a content script on X.com to extract post / article content and draw the inline download button |
| `webRequest` *(optional)* | **Fast Batch only** — read your X session's auth header to replay X's internal API. Requested only if you enable Fast Batch; never used otherwise |

**Your data never leaves your device. No data is collected, transmitted, or stored externally.** See [PRIVACY.md](PRIVACY.md).
