# Content AST — schema v1

The Content AST is the semantic source of truth for any content XClipper extracts. Renderers (Markdown, PDF, future HTML/EPUB/JSON) consume it; they never re-extract from the DOM. Every node is JSON-serializable so the AST can cross `chrome.runtime` message boundaries unchanged.

Types live in [`src/ast/types.ts`](../src/ast/types.ts). The architectural rationale lives in [`docs/adr/0001-content-ast-architecture.md`](./adr/0001-content-ast-architecture.md). This document is the per-node reference: shape, semantics, rendering expectations.

## Version

```ts
Document.version = 1
```

Breaking shape changes require bumping `version`. Additive changes (new optional fields, new node types not yet emitted) are non-breaking and don't require a bump.

## Top-level shape

```ts
interface Document {
  version: 1;
  metadata: DocumentMetadata;
  body: TweetNode | ThreadNode | ArticleNode;
}
```

`metadata` and `body` are separated deliberately. `metadata` carries facts about the source post (author, URL, date, engagement counts). `body` is the content tree. They evolve independently.

## Metadata

```ts
interface DocumentMetadata {
  type: 'tweet' | 'thread' | 'article';
  sourceUrl: string;       // canonical x.com/<handle>/status/<id> URL
  tweetId: string;         // numeric status id as string
  author: AuthorInfo;      // root post's author
  date: string;            // ISO 8601
  title?: string;          // articles only
  engagement?: EngagementCounts;
}
```

- `type` mirrors `body`'s node type — redundant but cheap to read and useful in consumers that only care about metadata.
- `author` here is the *root* author. For threads, individual tweets carry their own `author` on each `TweetNode`.
- `title` is article-only and identical to the article's first `HeadingNode` text; redundant but lets metadata consumers skip parsing the body.

## Block nodes

### TweetNode

```ts
interface TweetNode {
  type: 'tweet';
  author: AuthorInfo;
  date: string;
  tweetId: string;
  text: InlineNode[];
  media: MediaItem[];
  quotedTweet?: TweetNode;     // recursive; uncapped
  engagement?: EngagementCounts;
}
```

- `text` is the tweet body as inline nodes — no block-level structure inside a single tweet.
- `media` is an ordered array of attachments. Empty array (not omitted) when there are none.
- `quotedTweet` recurses; the AST imposes no nesting cap. Renderers may visually clamp depth (PDF page layout, etc.).
- `engagement` is per-tweet, distinct from `DocumentMetadata.engagement`. In a thread, only the root tweet typically has counts.

| Renderer | Expectation |
|---|---|
| Markdown | Author line + body + media as `![]()` + quoted tweet as nested blockquote |
| PDF | Twitter-card layout with avatar, name/handle row, body, media gallery, quoted tweet as nested card |

### ThreadNode

```ts
interface ThreadNode {
  type: 'thread';
  tweets: TweetNode[];
}
```

- A flat list of tweets. Renderers decide separators.

| Renderer | Expectation |
|---|---|
| Markdown | Tweets joined with `\n\n---\n\n` (or equivalent) |
| PDF | Each tweet as its own card, page breaks allowed between tweets |

### ArticleNode

```ts
interface ArticleNode {
  type: 'article';
  banner?: ImageNode;          // hero image; extractor-populated only
  children: Block[];
}
```

- `banner` is **never derived** by a renderer from `children[0]`. The extractor decides whether something is a banner; downstream code trusts that decision.
- `children` is a sequence of standard block nodes (paragraph, heading, list, code, image, etc.).

| Renderer | Expectation |
|---|---|
| Markdown | Optional banner `![]()` then children rendered in order |
| PDF | Banner styled distinctly (full-bleed, cropped); children flow as document body |

### PollNode

```ts
interface PollNode {
  type: 'poll';
  choices: PollChoice[];
  footer?: string;
}

interface PollChoice {
  label: string;
  percent?: number;
}
```

- Attached to a tweet via `TweetNode.poll`. Also a member of `Block` so it can appear inside articles in the future.
- `percent` is a number 0–100 (e.g. `20.9`). Present only on voted polls with results.
- `footer` is the "N votes · status" line, e.g. `"473 votes · Final results"` or `"5,309 votes · 3 days left"`.

### LinkCardNode

```ts
interface LinkCardNode {
  type: 'linkCard';
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  domain?: string;
}
```

- Attached to a tweet via `TweetNode.linkCard`. Represents X's URL-preview embeds (Open Graph cards), distinct from a quoted tweet or a quoted X-Notes article.
- Mutually exclusive with `TweetNode.quotedTweet` in practice — X's UI shows one embed slot.

### ParagraphNode / HeadingNode / ListNode / ListItemNode / CodeBlockNode / BlockquoteNode / ImageNode / VideoNode / ThematicBreakNode

Standard prose blocks. Field names follow [mdast](https://github.com/syntax-tree/mdast) conventions where they overlap (`children`, `value`, `depth`, `ordered`) so the shapes feel familiar — this is stylistic, not architectural.

```ts
interface ParagraphNode    { type: 'paragraph'; children: InlineNode[]; }
interface HeadingNode      { type: 'heading'; depth: 1|2|3|4|5|6; children: InlineNode[]; }
interface ListNode         { type: 'list'; ordered: boolean; children: ListItemNode[]; }
interface ListItemNode     { type: 'listItem'; children: Block[]; }
interface CodeBlockNode    { type: 'code'; lang?: string; value: string; }
interface BlockquoteNode   { type: 'blockquote'; children: Block[]; }
interface ImageNode        { type: 'image'; url: string; alt?: string; caption?: string; }
interface VideoNode        { type: 'video'; posterUrl: string; sourceUrl: string; alt?: string; }
interface ThematicBreakNode { type: 'thematicBreak'; }
```

- `BlockquoteNode` is for **article-level** quoted text. Quote-*tweets* use `TweetNode.quotedTweet`, not `BlockquoteNode`.
- `CodeBlockNode.lang` is the fenced language hint when present.
- `VideoNode.sourceUrl` is the playable media URL; `posterUrl` is the still-frame thumbnail. PDF and other static formats render the poster with a link to the source.

## Inline nodes

The inline taxonomy is intentionally minimal in v1. New inline types should be added only when an extraction case forces them (see the ADR's "minimum survivable" framing).

```ts
type InlineNode =
  | TextNode | LinkNode | EntityNode
  | EmphasisNode | StrongNode | InlineCodeNode
  | BreakNode;
```

### TextNode

```ts
interface TextNode { type: 'text'; value: string; }
```

Raw text. Emoji are passed through as Unicode in `value`; they are not modelled as a distinct node in v1.

### LinkNode

```ts
interface LinkNode { type: 'link'; url: string; children: InlineNode[]; }
```

A generic hyperlink with arbitrary inline content. `url` is the **resolved** final URL — `t.co` shorteners are unwrapped at extraction time.

### EntityNode

```ts
interface EntityNode {
  type: 'entity';
  kind: 'mention' | 'hashtag' | 'cashtag';
  value: string;            // handle / tag / symbol, WITHOUT the @ # $ prefix
  url: string;              // canonical x.com URL
}
```

Short structured tokens distinct from generic links. Renderers style each `kind` differently (e.g. mentions as `@chip`, hashtags as `#tag` chip). `value` is the bare token; renderers add the sigil.

### EmphasisNode / StrongNode / InlineCodeNode / BreakNode

```ts
interface EmphasisNode   { type: 'emphasis'; children: InlineNode[]; }
interface StrongNode     { type: 'strong'; children: InlineNode[]; }
interface InlineCodeNode { type: 'inlineCode'; value: string; }
interface BreakNode      { type: 'break'; }      // hard line break
```

`BreakNode` is a hard line break (e.g. `<br>` inside a paragraph or X's literal `\n` between text runs). Soft wrapping is the renderer's responsibility.

## Supporting types

```ts
interface AuthorInfo {
  name: string;
  handle: string;           // without @ prefix
  avatarUrl?: string;       // populated eagerly by extractor
  verified?: boolean;
}

interface MediaItem {
  kind: 'image' | 'video' | 'gif';
  url: string;              // see note below for video/gif
  posterUrl?: string;       // videos and gifs only
  alt?: string;
}

interface EngagementCounts {
  replies?: number;
  reposts?: number;
  likes?: number;
  bookmarks?: number;
  views?: number;
}
```

### `MediaItem.url` for video and gif

X serves video via MSE, so the `<source src>` is a session-bound `blob:` URL that expires immediately. Until a stable playable-URL strategy lands, the extractor sets `url = posterUrl` for `kind: 'video'` and `kind: 'gif'`. Renderers should treat the equality of the two fields as the "no playable source available" signal and fall back to embedding the poster with a link to the tweet's status URL.

## Explicitly excluded from v1

Add only when a fixture forces them:

- `TableNode`
- `FootnoteNode`
- `StrikethroughNode`
- `EmojiNode` — emoji ride along inside `TextNode.value` in v1
- Raw HTML escape hatch — deliberately no `HtmlNode`
- Embedded quote *cards* distinct from quoted tweets

## Invariants

- Every node is JSON-serializable. No DOM references, functions, `Map`, `Set`, or class instances anywhere in the tree.
- `children` arrays are never `undefined` — omit the field entirely if empty would be meaningful, otherwise emit `[]`.
- `Document.body` is always exactly one of `TweetNode | ThreadNode | ArticleNode`. There is no array root.
- All URLs are absolute and resolved (no `t.co` wrappers, no relative paths).
