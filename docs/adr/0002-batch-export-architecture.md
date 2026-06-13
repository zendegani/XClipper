# ADR 0002 — Batch export: harvest URLs, extract per permalink in a worker tab

- Status: **Accepted — Phases A–D shipped in v2.1.0**
- Date: 2026-06-11
- Deciders: @zendegani
- Supersedes: —
- Superseded by: —

## Context

XClipper exports exactly one item per user action: the popup (or inline
button / context menu) messages the content script on the **currently open
`/status/` page**, which extracts, renders, and delivers. Three things bind
the pipeline to a single permalink:

1. `domToAst()` / `extract()` hard-require a `/status/` URL and read the live
   `document` of the page they are standing in.
2. `content.js` is only injected on `*://x.com/*/status/*`; list pages
   (bookmarks, profiles, home timeline) only carry `injector.js`.
3. Orchestration lives in the popup, which dies the moment it closes.

We want **batch export**: many tweets/threads/articles in one job, sourced
from bookmarks, a specific user's profile, or a timeline selection.

The AST architecture (ADR 0001) already solved the output half — renderers
are pure `Document → output` functions and `postProcess` works per item. The
open questions are **acquisition** (how to obtain N tweets' content) and
**orchestration** (who runs a multi-minute job).

### Acquisition options considered

1. **Harvest URLs, visit every permalink.** Scroll the list page collecting
   status URLs, then load each permalink in a hidden worker tab and run the
   existing extractor there.
2. **Parse list cells in place.** Extract content directly from
   bookmark/timeline cell DOM without navigation.
3. **Hybrid.** Cells for plain tweets; permalink visits only for items the
   cell flags as truncated or threaded.
4. **GraphQL response interception.** Patch `fetch` in page context to read
   X's own API responses (which carry untruncated text and `self_thread`
   metadata).

Option 2 has permanently lower fidelity: cells truncate long tweets behind
"Show more", X-Notes articles don't render in lists at all, and quotes/polls
render differently — it is a second extractor to maintain beside the
fixture-tested one.

Option 3 fails on a detection gap that decided this ADR: **the root tweet of
a thread is rendered identically to a standalone tweet in list cells.** A
mid-thread tweet at least shows a "Replying to @author" hint; the root shows
nothing. There is no DOM signal in a bookmarks cell that nine more tweets
follow. A hybrid classifier therefore has false negatives exactly where they
hurt most — silently exporting tweet 1/10 as the whole item. Thread
membership is only knowable after loading the permalink (which is what
`collectSameAuthorArticles` already does).

Option 4 is the only way to know thread membership *without* visiting, but
it means injecting a `fetch` patch into page context — a large, fragile,
ToS-adjacent surface that would also draw Chrome Web Store scrutiny.
Recorded as known-possible, rejected for now.

## Decision

We will build batch export as **option 1**: a three-stage pipeline of
*source adapters* (collect URLs) → *batch orchestrator* (background-owned
job queue + one hidden worker tab) → *sinks* (deliver per-item results).
Fidelity is identical to single export by construction, because it **is**
the single-export path run N times. The speed cost is attacked directly
(early-abort page loads, resumable jobs) rather than traded away.

```
SOURCES (collect)             ORCHESTRATOR (background)          SINKS (deliver)
─────────────────             ─────────────────────────          ───────────────
bookmarks scroller    ─┐      BatchJob queue (persisted     ┌─→  folder of .md files
profile scroller       ├─→    to storage, resumable)    ────┼─→  JSON (AST) export
timeline selection    ─┘      → one hidden worker tab,      └─→  future: digest, …
  (harvest status URLs)         navigate → extract → next
```

### Architectural choices

| # | Choice | Rationale |
|---|---|---|
| 1 | Visit **every** permalink; no per-item cell parsing | Thread roots are undetectable in cells (see Context); one extractor, one fixture suite, full fidelity for threads/articles/quotes/polls |
| 2 | Source adapters only harvest `a[href*="/status/"]` + light metadata (author, date) while scrolling | Minimal X-DOM surface → resilient to markup churn; heavy parsing stays in the permalink extractor |
| 3 | Orchestrator lives in the **background service worker**, not the popup | Only context that survives popup close; owns tabs; single place for throttle/retry policy |
| 4 | `BatchJob` state machine (`queued → running i/N → done/cancelled`, plus `failed[]`) persisted to `chrome.storage.session` after every item | MV3 service workers can be killed mid-job; a restart resumes instead of orphaning a half-done batch |
| 5 | One **reused** inactive worker tab navigated URL-by-URL | Tab churn is slow and visually noisy; a single tab also serializes load, which is the throttle anyway |
| 6 | Reuse the existing `#xclipper=` auto-extract hash mechanism with a `batch` variant: content script extracts on load and messages the result to background | The trigger/extract/report loop already exists for the inline button and context menu; batch adds a subAction, not a mechanism |
| 7 | Throttle ~2–4 s per page with jitter; hard batch cap; visible pause/stop; pause the job if an error/login interstitial is detected | Behave like a patient user in their own session, not a scraper; X rate-limit or logout walls must pause, never hammer |
| 8 | Per-item failures (deleted, restricted, timeout) **skip and record** `{url, error}`; never abort the job | A 200-item export must not die at item 37; the summary reports failures explicitly |
| 9 | Early-abort page load (`window.stop()`) once `waitForArticle` resolves | The extractor needs rendered articles, not ads/recommendations below the fold; cuts per-item latency and bandwidth |
| 10 | Each result is finalized to markdown via the existing `postProcess` **as it completes** and handed to the sink; ASTs are not accumulated in memory | Bounded memory for large batches; partial output survives a crash |
| 11 | v1 sinks: **folder of per-item `.md` files** via `chrome.downloads` relative paths (`xclipper-batch-<date>/…`), plus a **JSON (AST) export** of the job | No zip dependency; the folder doubles as an Obsidian-vault drop; JSON is nearly free since `Document` is already JSON-serializable (ADR 0001 #7) |
| 12 | Obsidian delivery in batch = the folder sink pointed into a vault, **not** deeplinks | One OS-handler hop per note and URL-length limits make deeplinks unusable at N > a few |
| 13 | Per-item filenames reuse the existing `filenameTemplate`, with `-2`, `-3`… suffixes on collision | Same naming the user already configured; collisions are likely across a batch (same author + date) |
| 14 | First source: **bookmarks** (`/i/bookmarks`); then profile ("last N posts from @user"); then timeline checkbox selection | Bookmarks are well-bounded with the clearest intent ("export my saved stuff") and the simplest progress UX |

### Non-goals

- GraphQL/API interception (recorded above; revisit only if permalink
  visiting proves untenable).
- ~~Likes as a source~~ (added 2026-06-13 — see Amendments), scheduled/automatic
  re-sync, multi-platform sources.
- Parallel worker tabs in v1 (revisit if throttle headroom allows two).
- New renderers (digest, EPUB) — sinks consume existing renderer output.

## Consequences

- Batch speed is bounded by the throttle: ~100 bookmarks ≈ 5–7 minutes.
  This is accepted; the job is resumable and shows progress.
- New message types: `BatchStartRequest`, `BatchControlRequest`
  (pause/resume/cancel), `BatchProgressEvent`, and a content→background
  batch result message. `content.ts` splits "extract current page" from
  "respond to popup" routing.
- Permissions: likely **none new** — `chrome.tabs.create/remove/update`
  need no `"tabs"` permission, and the worker tab's URL is known because we
  set it; content-script completion pings replace `tabs.onUpdated`
  URL-watching. Verify in Phase A; if `"tabs"` turns out to be required,
  expect a Chrome Web Store re-review warning.
- PRIVACY.md gains a section stating batch processing stays entirely local
  (same as single export); store-listing wording reviewed before release.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| X rate-limits or logs out mid-batch | Throttle + jitter (#7); detect interstitials and pause with a clear message; resumable job |
| MV3 service worker killed mid-job | Persisted job state (#4); the open port to the worker tab also keeps the worker alive in practice |
| X DOM churn breaks the harvest selectors | Harvesters only depend on status-link hrefs (#2); permalink extraction risk is unchanged from today |
| Large batches exhaust memory | Stream per-item finalization to the sink (#10) |
| User closes/steals the worker tab | Detect tab loss, pause the job, recreate on resume |

## Migration plan

### Phase A — pipeline core

Background orchestrator + worker tab + `batch` hash trigger + folder sink.
No UI beyond a temporary trigger. **Verify:** feed 3 hardcoded status URLs
(tweet, thread, article) → 3 correct files in one folder; kill the service
worker mid-job → job resumes.

### Phase B — bookmarks source + popup UI

Harvester on `/i/bookmarks` (scroll, collect, dedupe, report count); popup
gains "Export bookmarks (N found)" with progress bar, pause/stop, and a
failure summary. JSON sink ships here. **Verify:** real bookmarks list with
a thread root and an article among the items exports both at full fidelity.

### Phase C — profile source + selection mode

"Last N posts from @user" (count/date cutoff), then checkbox selection
injected into timelines via `injector.js`.

### Phase D — additional sinks

Combined digest renderer (`Document[] → string`), other formats as demanded.

## Open questions

- JSON sink shape: one `data.json` per job (job metadata + `Document[]`)
  vs. per-item `.json` beside each `.md`. Leaning per-job single file.
- Whether bookmark harvesting should auto-scroll to exhaustion or export
  only what the user has scrolled into view ("N found" honesty vs.
  convenience). Leaning user-controlled scroll with a "load more" affordance.
- Retweets/reposts in sources: export the underlying tweet, skip, or make it
  a toggle.

## Amendments

- **2026-06-11 (Phase A testing):** the worker is a small *unfocused popup
  window*, not an inactive background tab (amends choice #5). Chrome never
  paints hidden tabs — `requestAnimationFrame` doesn't fire, so X's
  virtualized timeline neither mounts thread continuation tweets nor hydrates
  lazy media; batch exports came back with root-only threads and no images.
  An unfocused-but-visible window keeps rendering without stealing focus.
  Residual risk: a fully occluded window is treated as hidden again; affected
  items fail by per-item timeout and are recorded in the job summary.
- **2026-06-11 (Phase B):** two open questions resolved as leaned: the JSON
  sink is one `data.json` per job (job metadata + failures + every successful
  item's AST, assembled from per-item `chrome.storage.session` entries), and
  bookmark harvesting is user-controlled scroll — the injector accumulates
  permalinks as virtualized cells pass through the DOM, and the popup exports
  what has been loaded. Pause/resume abandons the in-flight item and
  re-dispatches it on resume.
- **2026-06-11 (post-Phase B):** duplicate avoidance via a persistent ledger
  of exported status ids (`chrome.storage.local`, capped at 5000):
  `startBatch` skips them, the popup counts "(N new)", and a Reset control
  clears the memory.
- **2026-06-11 (Phase C):** the profile source reuses the same harvester —
  user-controlled scroll on the profile page, not a "last N posts" count
  prompt — and skips reposts by keeping only the owner's own
  `/<handle>/status/` links (resolves the retweet open question: skip).
  Selection mode overlays per-cell check marks plus a floating export bar on
  any x.com timeline; it starts the batch from the injector, so BATCH_START
  also accepts our own x.com content-script sender.
- **2026-06-11 (Phase D):** combined digest ships as `renderDigest(docs)` —
  rendered documents joined with separators, written as `digest.md` next to
  the per-item files. Opt-in via a popup toggle (default off) since it's an
  extra file per batch.
- **2026-06-13 (Likes source):** added Likes as a fourth source, reversing the
  original non-goal. It reuses the harvest mechanism unchanged — the injector
  recognizes `/<handle>/likes` and, unlike a profile, keeps every author's
  permalink (likes are of other people's posts, not the page owner's). The
  `likes` origin is threaded through `HarvestResponse`, `BatchStartRequest`,
  and `BatchJob`; no new sink or folder logic, since the per-job folder name is
  origin-independent. The four sources now render as an icon-only tab strip
  (Bookmarks · Profile · Likes · Selection), each tab reusing its action
  button's glyph with the name moved to an aria-label + tooltip.

## References

- ADR 0001 — Content AST architecture (`0001-content-ast-architecture.md`)
- AST schema: `docs/ast-schema.md`
- Auto-extract hash mechanism: `src/content/content.ts` (`#xclipper=` bootstrap)
