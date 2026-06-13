# ADR 0003 — Fast Batch: acquire tweets via X's internal GraphQL (opt-in)

- Status: **Proposed — decisions locked; Phase 1 scaffolding underway (pure `jsonToAst` mapper). Permission/consent/orchestration await review.**
- Date: 2026-06-13
- Deciders: @zendegani
- Relates to: ADR 0001 (Content AST), ADR 0002 (Batch export)
- Supersedes: — (adds an alternate acquisition path; does **not** replace ADR 0002)

## Context

ADR 0002 batch acquires content by **navigating a worker tab to each
permalink and reading the rendered DOM**. Measured floor on real bookmarks:
**~2.4 s/item** — `nav` ~0.37 s, `waitForArticle` ~0.7 s, thread-walk ~1.4 s.
The last two are *rendering time*, not slack: they exist because we read the
DOM. The adaptive-settle work (branch `perf/batch-throttle-interstitial`)
squeezed the walk ~25 %, but the DOM approach is at its floor.

Faster competitors (e.g. the "Toolbox/Fast" bookmarks exporter, source
inspected) skip rendering entirely. Their mechanism, verified:

1. A `MAIN`-world content script monkey-patches `XMLHttpRequest` to observe
   x.com's own `Bookmarks` GraphQL calls and read the JSON `responseText`.
2. The background uses `chrome.webRequest.onBeforeSendHeaders` to capture the
   session's `authorization: Bearer …` and `x-csrf-token` headers, then
   **re-issues the GraphQL request itself**, paginating by `cursor` and
   parsing `bookmark_timeline_v2.timeline.instructions[].entries`.

This is **not** the paid Developer API (no key, no cost). It is x.com's own
**private/undocumented GraphQL**, reached with the user's existing logged-in
session. 100 bookmarks ≈ a few JSON pages ≈ a few seconds.

The AST architecture (ADR 0001) means only **acquisition** is in question:
renderers, `postProcess`, every format, the folder/JSON/combined sinks, the
dedup ledger, and filename logic are pure `Document → output` and are reused
unchanged. The problem reduces to: **obtain a `Document` per tweet from JSON
instead of from the DOM.**

## Decision (proposed)

Add **Fast Batch** as a *second, opt-in* batch acquisition path beside the
existing DOM worker-tab path — not a replacement.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Two modes, both kept.** Current batch stays as **Batch** (default, no new permission, no consent). Add a **Fast Batch** tab/toggle. | Privacy/ToS-conscious users keep a fully working batch; nobody loses the feature by declining. (User's framing.) |
| 2 | **Fast Batch is gated behind explicit, one-time consent.** A dialog states plainly: it reads your X session's auth token to call X's private API directly; it's faster; data still never leaves your browser; X may rate-limit. Stored as a setting (`fastBatchConsent`), revocable. | Token use is a meaningfully different posture; consent must be informed and deliberate, not a silent default. |
| 3 | **Acquisition = capture-and-replay GraphQL**, not hardcoded query-ids. Capture the live request URL (carries the rotating query-id + `features`) and the `authorization`/`x-csrf-token` headers via `webRequest`; re-issue with our own `cursor`. | Query-ids and `features` rotate; replaying the *observed* request survives rotation. Hardcoding would break constantly. |
| 4 | **Fetch from the background** with `credentials:'include'` (cookies ride via `host_permissions`) + captured csrf header. Seed headers from any live x.com GraphQL request (passively, or by briefly visiting the source page once). | No long-lived worker tab; simpler orchestration. The only thing a tab is needed for is seeding auth once. |
| 5 | **New `Document` producer: `jsonToAst` (tweet JSON → AST)**, sibling to `domToAst`. Lives in `src/graphql/` (or `src/content/json-to-ast/`), depends only on the JSON shape, never the DOM — mirrors the ADR 0001 plane split. | Keeps the AST the single source of truth; all renderers/sinks work untouched. |
| 6 | **Reuse the ADR 0002 orchestrator shape**: background-owned job, `chrome.storage.session` persistence, dedup ledger, sinks, pause/resume, the interstitial/rate-limit auto-pause. Swap "navigate worker tab → BATCH_ITEM_RESULT" for "fetch page → map entries → render → sink". | Maximal reuse; the queue/sink/UI machinery is identical. |
| 7 | **Pace GraphQL politely** (the throttle/auto-pause concept carries over): modest gap between pages, and **pause on HTTP 429 / GraphQL `errors`** with a clear reason, exactly like the DOM path's interstitial pause. | X rate-limits GraphQL; "never hammer" (ADR 0002 #7) applies here too. |
| 8 | **JSON fixtures + `.ast.json` snapshots** mirror the HTML-fixture test discipline (ADR 0002 testing): captured GraphQL responses (gitignored) → committed mapper-output snapshots. | The mapper is the fragile part; snapshot it so schema drift is caught. |

### Non-goals (this ADR)

- Replacing the DOM path for single-item export (popup/inline/context-menu) —
  one tweet is already fast; the DOM path stays the proven default there.
- Removing the DOM batch path — it is the no-consent fallback (#1).

## The hard part: JSON → AST mapping

Everything downstream is free; this table is ~all the real work. Source is the
GraphQL `tweet_results.result` object (`legacy` + siblings).

| AST (`src/ast/types.ts`) | GraphQL source | Notes / quirk risk |
|---|---|---|
| `author` | `core.user_results.result.legacy.{name,screen_name}`, `…verified`/`is_blue_verified`, avatar `…profile_image_url_https` | verified flag moved fields over time |
| `date` | `legacy.created_at` | parse X's format |
| `text` (InlineNode[]) | `note_tweet.note_tweet_results.result.text` **if present** (long-form), else `legacy.full_text`; entities from `…richtext`/`legacy.entities` | **Highest risk.** Must replicate DOM extractor's URL expansion (`entities.urls[].expanded_url`), mention/hashtag/cashtag → `EntityNode`, and **stripping trailing t.co media links** + the quoted-tweet self-link |
| `media` (MediaItem[]) | `legacy.extended_entities.media[]` → photo / video / animated_gif; video picks highest-bitrate mp4 `video_info.variants[]` | poster = `media_url_https`; alt = `ext_alt_text` |
| `poll` | `card.legacy.binding_values` (`choiceN_label`, `choiceN_count`, `end_datetime`) | card-type sniff |
| `linkCard` | `card.legacy` summary/summary_large_image bindings (title, description, domain, image) | distinguish from poll/article cards |
| `articleCard` / `quotedTweet` | `quoted_status_result.result` → **recurse** `jsonToAst` | recursion gives quotes/embeds for free (same property as DOM path) |
| `engagement` | `legacy.{reply,retweet,favorite,quote,bookmark}_count`, `views.count` | trivial |
| `ThreadNode` | timeline self-thread module **or** `TweetDetail` conversation per root | see phasing — parity gap if skipped |
| `ArticleNode` | X Article long-form (separate GraphQL field/op) | **Second-highest risk** — distinct content model; defer |

## Phasing (proposed)

- **Phase 1 — Bookmarks, single tweets.** `Bookmarks` op; map tweet + quote +
  media + cards + polls + engagement. Threads exported as their **root tweet
  only** (documented parity gap vs. DOM batch). Proves the whole pipeline end
  to end behind the consent gate. *This is the milestone that demonstrates the
  10×.*
- **Phase 2 — Likes + Profile sources.** `Likes`, `UserTweets`
  (+ `UserByScreenName` for the rest-id). Same mapper.
- **Phase 3 — Parity.** Thread expansion via `TweetDetail`; X Articles. Closes
  the gaps so Fast Batch ≈ DOM batch in completeness, not just speed.

## Consequences

- **Speed:** ~0.1–0.3 s/item, trivially parallel — bookmarks/likes/profile go
  from minutes to seconds. The headline win.
- **New permission:** `webRequest` (host-scoped to x.com). Needs justification,
  an issue, and a **PRIVACY.md** update (manifest minimal-permissions rule).
- **New maintenance surface:** `jsonToAst` re-derives quirk handling the DOM
  extractor earned over time; X schema drift breaks it (mitigated by #8).
  Two acquisition paths to keep working.
- **ToS posture shift:** from "reads the page you're already shown" to "calls
  X's private API on your behalf." Mitigated user-side by opt-in consent (#2);
  must be documented honestly project-side.
- **Rate limits:** X caps GraphQL; large jobs can 429 → handled by the
  carried-over auto-pause (#7).
- **Reuse:** renderers, `postProcess`, all formats, sinks, dedup, filenames,
  combined/JSON outputs — **unchanged**.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| X rotates query-ids / `features` | Capture-and-replay the live request (#3), don't hardcode |
| GraphQL response schema drifts | JSON fixtures + `.ast.json` snapshots (#8); fail loud per ADR 0002's "unsupported branches throw" ethos |
| Auth header not yet captured | Seed from a one-time x.com visit / passive capture (#4); clear UX if unavailable |
| Rate-limited mid-job | 429/`errors` → auto-pause with reason, resumable (#7) |
| User uncomfortable with token use | Opt-in only; DOM batch remains the default (#1, #2) |

## Resolved decisions (2026-06-13)

Proceeding on the recommended options so Phase 1 can start:

1. **Surface → mode toggle.** A **Standard / Fast ⚡** toggle on the existing
   batch bar, applied to whichever source (Bookmarks/Likes/Profile/Selection)
   is selected — reuses the source tabs instead of duplicating them.
2. **Phase-1 thread handling → ship root-tweet-only** behind the consent gate,
   with a visible "threads/articles use Standard batch for now" hint. Thread
   (`TweetDetail`) + Article parity is Phase 3; decision #1 keeps both modes,
   so completeness is never lost — Standard covers the gap meanwhile.
3. **Branch → own feature branch** `feat/fast-batch-graphql`, off `main`,
   independent of the in-flight `perf/batch-throttle-interstitial` work.

### Build order within Phase 1

1. **Pure `jsonToAst` mapper + tests** (no Chrome APIs, no manifest change) —
   the de-risking step, *scaffolded now*. Fixtures are **modeled on X's
   documented GraphQL schema and must be re-validated against a real captured
   response** (needs a logged-in session) before the fetch layer is trusted.
2. Auth capture (`webRequest`) + background GraphQL fetch/pagination — **needs
   the permission decision + PRIVACY.md; deferred to review.**
3. Consent gate + Standard/Fast toggle UI — **deferred to review.**
4. Orchestration: reuse the ADR 0002 sinks / dedup / pause machinery.

## References

- ADR 0001 — Content AST architecture
- ADR 0002 — Batch export (DOM worker-tab path; orchestration reused here)
- AST schema: `docs/ast-schema.md`, `src/ast/types.ts`
- Mechanism confirmed in: `_local/fast/{content_v2,background}.*.js` (webRequest
  header capture + GraphQL cursor replay)
