# Contributing to tweet2md

Thanks for your interest. This file captures the working conventions for the project — read it before opening a PR.

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
- Prefer adding to an existing module over creating a new one, unless the new module has a clearly separable responsibility. The current split under `src/content/` (`markdown`, `dom`, `tweet`, `article`, `wait`) is the size we aim for.
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
