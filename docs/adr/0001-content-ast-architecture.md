# ADR 0001 — Content AST as the source of truth for tweet/article content

- Status: **Proposed**
- Date: 2026-06-03
- Deciders: @zendegani
- Supersedes: —
- Superseded by: —

## Context

tweet2md extracts X (Twitter) content (tweets, threads, articles) and produces Markdown. The pipeline today is:

```
DOM → metadata + Turndown(DOM) → ExtractedContent { markdown: string, … } → .md file
```

`ExtractedContent.markdown` is a rendered string. There is no intermediate semantic representation of the body. Tweet-specific semantics (quote-tweet nesting, gallery vs single image, mention vs link, poll structure) are flattened away at extraction time.

We want to add **PDF export** (real selectable text, embedded images, clickable links) and remain open to **HTML / EPUB / JSON** in the future. Two architectures are available:

1. **DOM → Markdown → PDF.** Reuse the existing markdown string, parse with `marked`, pipe to `html2pdf`. Ships fast (~50 LOC). Loses any tweet-specific semantics that don't survive the markdown round-trip.
2. **DOM → Content AST → {MD, PDF, HTML, EPUB, JSON}.** Refactor `ExtractedContent.markdown: string` into `ExtractedContent.body: Document` where `Document` is a typed AST of semantic blocks. Renderers are separate; markdown becomes one renderer among several.

This ADR records the decision to pursue option 2 and the constraints that decision implies.

## Decision

We will refactor the extraction layer to emit a typed **Content AST** as the source of truth. Markdown becomes a renderer, not the source.

The AST is **domain-first** (tweet/thread/article are first-class nodes), **JSON-serializable**, **versioned**, and **documented alongside the code**.

The migration is **incremental**: Turndown stays running in parallel until per-fixture parity is achieved, then is removed.

### v1 framing — minimum survivable, not complete

The AST defined in this ADR is **a minimum survivable model**, not a final document system. New node types will be added when an extraction case forces them. Examples already anticipated: polls, embedded quote cards distinct from quoted tweets, "article-in-tweet" hybrid cards, soft threads inside articles, system/promo tweets. The schema document carries the live shape; the version field carries the contract.

### Architectural choices

| # | Choice | Rationale |
|---|---|---|
| 1 | Incremental migration: Turndown runs in parallel until per-fixture parity is achieved | Extraction quality is the product's biggest asset; a clean cutover risks silent regressions |
| 2 | **Semantic parity**, not byte parity, validated by **golden snapshot tests gated in CI** | Byte parity is a months-long trap; snapshot drift fails the build; updating goldens requires explicit PR approval |
| 3 | Snapshot at **two layers**: AST snapshots (JSON) and rendered-Markdown snapshots | MD snapshots alone let AST-level regressions slip through silently once Markdown is no longer the source of truth |
| 4 | **Custom AST** with tweet-specific node types — not mdast/unified | tweet2md is an X-content project, not a markdown project; mdast plugins add value only when renderers are not owned, and all renderers here are owned |
| 5 | Threads are an explicit `ThreadNode` containing `TweetNode[]` | A thread is a first-class semantic object; renderers decide presentation (MD separators, PDF pagination, HTML container) |
| 6 | Quote-tweet nesting is recursive and **uncapped at the AST level** | `QuotedTweetNode { tweet: TweetNode }` is naturally recursive; renderers may clamp visually for layout sanity |
| 7 | AST is **fully JSON-serializable** (no `Element`, `Node`, `Function`, `Map`, `Set`) | Required for `chrome.runtime.sendMessage` between content / background / popup; also unlocks persistence, debugging dumps, fixture round-trips |
| 8 | Keep `ExtractedContent.markdown: string` as a **derived field** during and after migration | Avoids breaking popup, background, filename, download consumers; removable in a later major version |
| 9 | `document.version: 1` on the wire from day one | Versioning is free now and painful later — especially once exported JSON or third-party plugins appear |
| 10 | Where types overlap with mdast (paragraph, heading, list, link, emphasis, strong, code), match mdast field naming conventions (`children`, `value`, `depth`, `ordered`) | Stylistic, not architectural — costs nothing and keeps shapes familiar to contributors and future tools |
| 11 | Mentions, hashtags, cashtags use a unified `EntityNode` with a `kind` discriminator | Renderers still style each kind differently; the discriminator avoids X-specific bias in the core AST and keeps inline taxonomy stable if other platforms are added |
| 12 | Ship a **1-page AST schema document** with v1 (`docs/ast-schema.md`) | The version field is useless without documentation; the schema doc is the debugging reference, plugin contract, and migration anchor |

### Non-goals

- Not building on mdast/unified.
- Not preserving Turndown's exact byte output.
- Not over-designing the inline taxonomy — start minimal, expand under pressure.
- Not designing for hypothetical EPUB/HTML renderers today. The AST shape must not preclude them; no renderer code lands speculatively.
- Not modeling X content as a graph. The AST is tree-shaped. Real X content sometimes drifts toward graph shape (articles embedding tweets embedding articles); this is an accepted v1 limitation.

## Consequences

### Positive

- PDF, HTML, EPUB and JSON exports become additive: one renderer each, no further refactor.
- Tweet-specific semantics survive into every output format.
- The AST is debuggable, dumpable, diffable — easier to test than markdown strings.
- Removes Turndown as a runtime dependency once cutover is complete (~27 KB minified saved).
- Fixture tests gain two regression layers: AST snapshot + rendered MD snapshot.

### Negative

- PDF feature ships later than the markdown-round-trip path would have. Realistic budget for v1 AST + extractor + MD renderer + parity gate, before PDF work begins: **4–6 weeks of focused work.**
- Two code paths exist during the migration window; bug fixes may need to be applied to both.
- The AST is a contract once shipped. Future shape changes require version bumps and possibly migration code.
- Inline vocabulary will iterate. Expect node-type additions through v1.x.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Silent MD output regression vs Turndown | Snapshot-gated CI from the first commit; updating goldens requires PR approval |
| Silent AST regression once MD is no longer source-of-truth | AST-level snapshots per fixture, independent of MD snapshots |
| AST over-design — modeling things no extractor produces | Start with the inline/block set the existing fixtures *prove* are needed; add nodes only when a new fixture forces it |
| Extraction correctness — not AST elegance — is the real engineering challenge | Phase budget reflects this; Phase 2 dominates the timeline |
| X DOM changes break the new extractor | Same risk as today; mitigated by the same fixture suite |
| `chrome.runtime` message size grows | AST is more verbose than a markdown string; spot-check serialized size on the longest article fixture; if it crosses ~1 MB, revisit |

## Migration plan

### Phase 0 — Baseline (½ day)

- Add a snapshot test that, for every fixture in `tests/fixtures/`, asserts the current Turndown MD output matches the checked-in `.md` file byte-for-byte.
- This test is the regression floor for the rest of the migration. It must stay green throughout Phases 1–3.

### Phase 1 — Define AST v1 (1–2 days)

- Create `src/ast/types.ts` with the v1 node vocabulary (see *Schema v1* below).
- Create `docs/ast-schema.md` documenting each node, its fields, and rendering expectations per output format.
- Add `Document.version: 1` and separate `Document.metadata` from `Document.body`.

### Phase 2 — Build `domToAst()` extractor (2–4 weeks)

- New file `src/content/dom-to-ast.ts` walks the same DOM as the current extractor but emits `Document`.
- Build fixture-by-fixture, smallest first: single tweet → tweet with media → quote tweet → thread → article → RTL → poll (if a fixture appears).
- Each fixture lands with two snapshots: the AST (JSON) and a placeholder for the rendered MD (Phase 3).
- This phase dominates the timeline. X DOM is inconsistent and edge-case-heavy; estimate accordingly.

### Phase 3 — `renderMarkdown(doc)` (1 week)

- New file `src/ast/render-markdown.ts`. Pure function: `Document → string`.
- Goal: produce output semantically equivalent to today's Turndown output for every fixture.
- Diffs against Phase 0 goldens are either a renderer bug to fix or a justified improvement requiring explicit golden update in PR.

### Phase 4 — Cutover (½ day)

- `ExtractedContent.body = doc; ExtractedContent.markdown = renderMarkdown(doc);` — keep `markdown` on the wire for backward compatibility.
- Remove Turndown from runtime. Keep it in `devDependencies` only as the Phase 0 oracle for the regression test, until confidence is high enough to retire the oracle in a follow-up.

### Phase 5 — PDF renderer (1 week)

- `src/ast/render-pdf-html.ts`: `Document → Twitter-styled HTML`.
- `marked` is not needed (no MD round-trip).
- Wire `html2pdf` in the content script next to the markdown download path.

### Phase 6+ — Future renderers (deferred)

- HTML, EPUB, JSON: each an additional renderer module. Not in this ADR's scope.

## Schema v1 (sketch — full spec lives in `docs/ast-schema.md`)

```ts
interface Document {
  version: 1;
  metadata: DocumentMetadata;
  body: Block;            // one of TweetNode | ThreadNode | ArticleNode
}

interface DocumentMetadata {
  type: 'tweet' | 'thread' | 'article';
  sourceUrl: string;
  tweetId: string;
  author: AuthorInfo;
  date: string;           // ISO 8601
  title?: string;
  engagement?: EngagementCounts;
}

// --- Block nodes ---
type Block =
  | TweetNode
  | ThreadNode
  | ArticleNode
  | ParagraphNode
  | HeadingNode
  | ListNode
  | CodeBlockNode
  | BlockquoteNode    // article-only quoted text — NOT a quote-tweet
  | ImageNode
  | VideoNode
  | ThematicBreakNode;

interface TweetNode {
  type: 'tweet';
  author: AuthorInfo;
  date: string;
  tweetId: string;
  text: InlineNode[];
  media: MediaItem[];
  quotedTweet?: TweetNode;   // recursive; uncapped
  engagement?: EngagementCounts;
}

interface ThreadNode {
  type: 'thread';
  tweets: TweetNode[];
}

interface ArticleNode {
  type: 'article';
  banner?: ImageNode;        // extractor-provided; never derived in renderer
  children: Block[];
}

interface ParagraphNode { type: 'paragraph'; children: InlineNode[]; }
interface HeadingNode   { type: 'heading'; depth: 1|2|3|4|5|6; children: InlineNode[]; }
interface ListNode      { type: 'list'; ordered: boolean; children: ListItemNode[]; }
interface ListItemNode  { type: 'listItem'; children: Block[]; }
interface CodeBlockNode { type: 'code'; lang?: string; value: string; }
interface BlockquoteNode { type: 'blockquote'; children: Block[]; }
interface ImageNode     { type: 'image'; url: string; alt?: string; caption?: string; }
interface VideoNode     { type: 'video'; posterUrl: string; sourceUrl: string; alt?: string; }
interface ThematicBreakNode { type: 'thematicBreak'; }

// --- Inline nodes (minimal v1; expand under pressure) ---
type InlineNode =
  | TextNode
  | LinkNode
  | EntityNode
  | EmphasisNode
  | StrongNode
  | InlineCodeNode
  | BreakNode;

interface TextNode      { type: 'text'; value: string; }
interface LinkNode      { type: 'link'; url: string; children: InlineNode[]; }
interface EntityNode    {
  type: 'entity';
  kind: 'mention' | 'hashtag' | 'cashtag';
  value: string;          // handle / tag / symbol, without the @ # $ prefix
  url: string;
}
interface EmphasisNode  { type: 'emphasis'; children: InlineNode[]; }
interface StrongNode    { type: 'strong'; children: InlineNode[]; }
interface InlineCodeNode { type: 'inlineCode'; value: string; }
interface BreakNode     { type: 'break'; }   // hard line break

// --- Supporting types ---
interface AuthorInfo { name: string; handle: string; avatarUrl?: string; verified?: boolean; }
interface MediaItem  { kind: 'image' | 'video' | 'gif'; url: string; posterUrl?: string; alt?: string; }
interface EngagementCounts {
  replies?: number;
  reposts?: number;
  likes?: number;
  bookmarks?: number;
  views?: number;
}
```

### Explicitly excluded from v1

Add only when a fixture forces them:

- `PollNode`
- `TableNode`
- `FootnoteNode`
- `StrikethroughNode`
- `EmojiNode` (treated as `TextNode` in v1 — grapheme handling is a renderer concern)
- Raw HTML escape hatch — deliberately no `HtmlNode`
- Embedded quote *cards* distinct from quoted tweets

## Resolved decisions on boundary behavior

These were considered open during ADR drafting. None block v1; recording for posterity so the same questions are not re-litigated during implementation.

| Topic | Decision | Notes |
|---|---|---|
| `t.co` URL handling | `LinkNode.url` holds the resolved final URL | Optional `rawUrl?: string` may be added later if debugging requires it. AST should represent semantic intent, not transport artifacts |
| Avatar URLs in `AuthorInfo` | Eager fetch at extraction time | Keeps AST self-contained, makes PDF/HTML rendering deterministic and offline-safe |
| Article banner image | Explicit `ArticleNode.banner` field, populated by the extractor | Never derived from "first ImageNode in children" inside a renderer — banners behave differently from inline images |
| Obsidian post-processing integration | Phase 1–3: keep current `AST → markdown → Obsidian` pipeline unchanged. Future: optional `renderObsidian(doc)` adapter | Does not block AST design; addressed once core renderers are stable |

## References

- v1 schema (live document): `docs/ast-schema.md`
- Existing fixtures: `tests/fixtures/*.html` + `*.md`
- Existing message types: `src/types/messages.ts`
- mdast / unified (consulted, not adopted): https://github.com/syntax-tree/mdast
