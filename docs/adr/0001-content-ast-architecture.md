# ADR 0001 — Content AST as the source of truth for tweet/article content

- Status: **Proposed**
- Date: 2026-06-03
- Deciders: @zendegani
- Supersedes: —
- Superseded by: —

## Context

tweet2md today extracts X (Twitter) content (tweets, threads, articles) and produces Markdown. The pipeline is:

```
DOM → metadata + Turndown(DOM) → ExtractedContent { markdown: string, … } → .md file
```

`ExtractedContent.markdown` is a rendered string. There is no intermediate semantic representation of the body.

We want to add **PDF export** (real, selectable text, embedded images, clickable links) and remain open to **HTML / EPUB / JSON** in the future. Two architectures are available:

1. **DOM → Markdown → PDF.** Reuse the existing markdown string, parse it with `marked`, pipe to `html2pdf`. Ships fast (~50 LOC). Loses tweet-specific semantics that don't survive a markdown round-trip (quote-tweet nesting, media gallery vs single image, mention vs link, poll structure, etc.).
2. **DOM → Content AST → {MD, PDF, HTML, EPUB}.** Refactor `ExtractedContent.markdown: string` into `ExtractedContent.body: Document` where `Document` is a typed AST of semantic blocks. Renderers are separate; markdown becomes one renderer among several.

This ADR records the decision to pursue option 2 and the constraints that decision implies.

## Decision

We will refactor the extraction layer to emit a typed **Content AST** as the source of truth. Markdown becomes a renderer, not the source.

The AST is **domain-first** (tweet/thread/article are first-class nodes), **JSON-serializable**, **versioned**, and **documented** alongside the code.

The migration is **incremental**: Turndown stays running in parallel until per-fixture parity is achieved, then is removed.

### Eight architectural choices

| # | Choice | Rationale |
|---|---|---|
| 1 | Incremental migration (Turndown + AST in parallel) | Extraction quality is the product's biggest asset. A clean cutover risks silent regressions. |
| 2 | **Semantic parity**, not byte parity, with **golden snapshot gating** | Byte parity is a months-long trap. Snapshot tests run in CI; drift fails the build; PR approval required to update goldens. Not literal human review of every diff. |
| 3 | **Custom AST** with tweet-specific node types — not mdast/unified | tweet2md is an X-content project, not a markdown project. mdast plugins add value when you don't own the renderer; we will own all renderers. |
| 4 | Threads are an explicit `ThreadNode` containing `TweetNode[]` | A thread is a first-class semantic object. Renderers decide presentation (MD separators, PDF pagination, HTML container). |
| 5 | Quote-tweet nesting is **recursive, uncapped** at the AST level | The data shape `QuotedTweetNode { tweet: TweetNode }` is naturally recursive. Renderers may clamp visually for layout sanity. |
| 6 | AST is **fully JSON-serializable** (no `Element`, `Node`, `Function`, `Map`, `Set`) | Required for `chrome.runtime.sendMessage` between content / background / popup. Also unlocks persistence, debugging dumps, fixture round-trips. |
| 7 | Keep `ExtractedContent.markdown: string` as a **derived field** during and after migration | Avoids breaking popup, background, filename, download consumers. Removable in a later major version once all consumers migrate. |
| 8 | `document.version: 1` on the wire from day one | Versioning is free now and painful later, especially once exported JSON or third-party plugins appear. |

### Four supporting rules

| # | Rule |
|---|---|
| 9 | **Baseline snapshot** every existing fixture's Turndown MD output before any refactor begins. CI gate from commit one. |
| 10 | For block/inline types that *do* overlap with mdast (paragraph, heading, list, link, emphasis, strong, code), match mdast field naming conventions (`children`, `value`, `depth`, `ordered`). Stylistic, not architectural. |
| 11 | Mentions, hashtags, cashtags are **first-class inline node types**, not a discriminator on `LinkNode`. Renderers style them differently. |
| 12 | Ship a **1-page AST schema document** with v1 (`docs/ast-schema.md`). The version field is useless without it. |

### Non-goals

- **Not** building on mdast/unified.
- **Not** preserving Turndown's exact byte output.
- **Not** over-designing the inline taxonomy. Start minimal; expand when an extraction case forces it.
- **Not** designing for a hypothetical EPUB/HTML renderer today. The AST shape must *not preclude* them, but no renderer code lands speculatively.

## Consequences

### Positive

- PDF, HTML, EPUB and JSON exports become additive: one renderer each, no refactor.
- Tweet-specific semantics (quote nesting, mention vs link, gallery vs single image, poll) survive into every output format.
- The AST is a debuggable, dumpable, diffable representation. Much easier to test than markdown strings.
- Removes Turndown as a dependency once cutover is complete (~27 KB minified saved).
- Fixture tests become snapshot tests against the AST *and* against rendered MD — two layers of regression protection.

### Negative

- PDF feature ships later than the markdown-round-trip path would have. Estimated 2–4 weeks of focused work for v1 AST + extractor + MD renderer + parity gate, before PDF work even begins.
- During the migration window, two code paths exist; bug fixes may need to be applied to both.
- The AST is a contract once shipped. Future shape changes require version bumps and possibly migration code.
- Inline vocabulary will iterate (see rule 11 + GPT's "extraction consistency is the real risk"). Expect node type additions through v1.x.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Silent MD output regression vs Turndown | Snapshot-gated CI from commit one (rule 9). |
| AST over-design — modeling things no extractor produces | Start with the inline/block set the 7 existing fixtures *prove* are needed. Add nodes when a new fixture forces it. |
| X DOM changes break the new extractor | Same risk as today; mitigated by the same fixture suite. The AST refactor neither helps nor hurts here. |
| `chrome.runtime` message size grows | AST is more verbose than a markdown string. Spot-check serialized size on the longest article fixture; if it crosses ~1 MB, revisit. |

## Migration plan

### Phase 0 — Baseline (½ day)

- Add a snapshot test that, for every fixture in `tests/fixtures/`, asserts the current Turndown MD output matches the checked-in `.md` file byte-for-byte.
- This test is the **regression floor** for the rest of the migration. It must stay green throughout.

### Phase 1 — Define AST v1 (1–2 days)

- Create `src/ast/types.ts` with the v1 node vocabulary (see *Schema v1* below).
- Create `docs/ast-schema.md` documenting each node, its fields, and rendering expectations per output format.
- Add `document.version: 1` and `Document.metadata` (separated from `Document.body`).

### Phase 2 — Build `domToAst()` extractor (1–2 weeks)

- New file `src/content/dom-to-ast.ts` walks the same DOM as the current extractor but emits `Document`.
- Build fixture-by-fixture, smallest first: single tweet → tweet with media → quote tweet → thread → article → RTL → poll.
- Each fixture lands with two snapshots: the AST (JSON) and a placeholder for the rendered MD (Phase 3).

### Phase 3 — `renderMarkdown(doc)` (1 week)

- New file `src/ast/render-markdown.ts`. Pure function: AST → string.
- Goal: produce output **semantically equivalent** to today's Turndown output for every fixture.
- Diffs against Phase 0 goldens are either (a) a renderer bug to fix or (b) a justified improvement requiring explicit golden update in PR.

### Phase 4 — Cutover (½ day)

- `ExtractedContent.body = doc; ExtractedContent.markdown = renderMarkdown(doc);` — keep `markdown` on the wire (decision #7).
- Remove Turndown from runtime. Keep it in `devDependencies` only as the baseline reference for the snapshot regression test (it remains the "Phase 0" oracle until everyone agrees the new renderer is the source of truth).
- Optionally retire the Phase 0 oracle in a follow-up once confidence is high.

### Phase 5 — PDF renderer (1 week)

- `src/ast/render-pdf-html.ts`: AST → Twitter-styled HTML.
- Bundle `marked` is unnecessary now (no MD round-trip).
- Wire `html2pdf` in the content script next to the markdown download path.

### Phase 6+ — Future renderers (deferred)

- HTML, EPUB, JSON: each is an additional renderer module. Not in this ADR's scope.

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
  engagement?: { replies?: number; reposts?: number; likes?: number; bookmarks?: number; views?: number };
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
  | BlockquoteNode    // article-only quoted text, NOT a quote-tweet
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
  banner?: ImageNode;
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

// --- Inline nodes (minimal v1; expand under pressure per rule 11) ---
type InlineNode =
  | TextNode
  | LinkNode
  | MentionNode
  | HashtagNode
  | CashtagNode
  | EmphasisNode
  | StrongNode
  | InlineCodeNode
  | BreakNode;

interface TextNode      { type: 'text'; value: string; }
interface LinkNode      { type: 'link'; url: string; children: InlineNode[]; }
interface MentionNode   { type: 'mention'; handle: string; url: string; }
interface HashtagNode   { type: 'hashtag'; tag: string; url: string; }
interface CashtagNode   { type: 'cashtag'; symbol: string; url: string; }
interface EmphasisNode  { type: 'emphasis'; children: InlineNode[]; }
interface StrongNode    { type: 'strong'; children: InlineNode[]; }
interface InlineCodeNode { type: 'inlineCode'; value: string; }
interface BreakNode     { type: 'break'; }   // hard line break

// --- Supporting types ---
interface AuthorInfo { name: string; handle: string; avatarUrl?: string; verified?: boolean; }
interface MediaItem  { kind: 'image' | 'video' | 'gif'; url: string; posterUrl?: string; alt?: string; }
interface EngagementCounts { replies?: number; reposts?: number; likes?: number; bookmarks?: number; views?: number; }
```

### Explicitly excluded from v1

These will be added when a fixture forces them — not before:

- `PollNode`
- `TableNode`
- `FootnoteNode`
- `StrikethroughNode`
- `EmojiNode` (treated as `TextNode` in v1 — grapheme handling is a renderer concern)
- Raw HTML escape hatch (deliberately no `HtmlNode`)

## Open questions

These do not block the ADR but need answers before Phase 2 lands:

1. **t.co URL unwrapping** — does the extractor unwrap `t.co` shorteners into `LinkNode.url`, or preserve the wrapped form? Today's extractor unwraps; verify this carries through.
2. **Avatar URLs in `AuthorInfo`** — fetched eagerly at extraction time, or left to renderer? Eager keeps the AST self-contained; lazy keeps it lighter.
3. **Banner image on articles** — is `banner` actually a distinct concept from "first ImageNode in children", or should we represent it uniformly?
4. **Where does `obsidian` post-processing fit?** Today it operates on the markdown string. In the new model it should operate on `Document` (e.g., wikilink-ify mentions). Confirm before Phase 4.

## References

- Discussion log: `_local/pdf.md`, `_local/pdf-gpt.md`, `_local/pdf-opus.md`
- Existing fixtures: `tests/fixtures/*.html` + `*.md` (7 pairs at time of writing)
- Existing message types: `src/types/messages.ts`
- mdast / unified (consulted, not adopted): https://github.com/syntax-tree/mdast
