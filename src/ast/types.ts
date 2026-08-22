// Content AST v1 — see docs/ast-schema.md and docs/adr/0001-content-ast-architecture.md.
// Every node must be JSON-serializable: no Element, Node, Function, Map, Set.

export interface Document {
  version: 1;
  metadata: DocumentMetadata;
  body: TweetNode | ThreadNode | ArticleNode;
}

export interface DocumentMetadata {
  type: 'tweet' | 'thread' | 'article';
  sourceUrl: string;
  tweetId: string;
  author: AuthorInfo;
  date: string;
  title?: string;
  engagement?: EngagementCounts;
}

export type Block =
  | TweetNode
  | ThreadNode
  | ArticleNode
  | ParagraphNode
  | HeadingNode
  | ListNode
  | ListItemNode
  | CodeBlockNode
  | BlockquoteNode
  | ImageNode
  | VideoNode
  | TableNode
  | PollNode
  | LinkCardNode
  | ArticleCardNode
  | ThematicBreakNode;

export interface TweetNode {
  type: 'tweet';
  author: AuthorInfo;
  date: string;
  tweetId: string;
  text: InlineNode[];
  media: MediaItem[];
  poll?: PollNode;
  linkCard?: LinkCardNode;
  articleCard?: ArticleCardNode;
  quotedTweet?: TweetNode;
  engagement?: EngagementCounts;
}

export interface ThreadNode {
  type: 'thread';
  tweets: TweetNode[];
}

export interface ArticleNode {
  type: 'article';
  banner?: ImageNode;
  children: Block[];
}

export interface ParagraphNode {
  type: 'paragraph';
  children: InlineNode[];
}

export interface HeadingNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
}

export interface ListNode {
  type: 'list';
  ordered: boolean;
  children: ListItemNode[];
}

export interface ListItemNode {
  type: 'listItem';
  children: Block[];
}

export interface CodeBlockNode {
  type: 'code';
  lang?: string;
  value: string;
}

export interface BlockquoteNode {
  type: 'blockquote';
  children: Block[];
}

export interface ImageNode {
  type: 'image';
  url: string;
  alt?: string;
  caption?: string;
}

export interface VideoNode {
  type: 'video';
  posterUrl?: string;
  sourceUrl: string;
  alt?: string;
}

// X Article tables. `header` is the `<th>` row when the source has one —
// markdown tables require a header row, so renderers emit an empty one when
// it's absent rather than promoting a data row and losing a line of content.
export interface TableNode {
  type: 'table';
  header?: TableRowNode;
  children: TableRowNode[];
}

export interface TableRowNode {
  type: 'tableRow';
  children: TableCellNode[];
}

export interface TableCellNode {
  type: 'tableCell';
  children: InlineNode[];
}

export interface PollNode {
  type: 'poll';
  choices: PollChoice[];
  footer?: string;
}

export interface PollChoice {
  label: string;
  percent?: number;
}

export interface LinkCardNode {
  type: 'linkCard';
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  domain?: string;
}

// X's long-form Article preview card. Looks superficially like a LinkCard
// but: (a) it's an X-native artifact, not an OG preview; (b) it appears in
// quote position of a tweet OR inline in an article body; (c) it has no
// domain (it's hosted by X) and may have no resolvable URL exposed in DOM.
// Keeping it a separate node makes renderer branching clean (📝 vs 🔗 and
// the slightly different field set).
export interface ArticleCardNode {
  type: 'articleCard';
  title: string;
  description?: string;
  imageUrl?: string;
  url?: string;
}

export interface ThematicBreakNode {
  type: 'thematicBreak';
}

export type InlineNode =
  | TextNode
  | LinkNode
  | EntityNode
  | EmphasisNode
  | StrongNode
  | InlineCodeNode
  | BreakNode;

export interface TextNode {
  type: 'text';
  value: string;
}

export interface LinkNode {
  type: 'link';
  url: string;
  children: InlineNode[];
}

export interface EntityNode {
  type: 'entity';
  kind: 'mention' | 'hashtag' | 'cashtag';
  value: string;
  url: string;
}

export interface EmphasisNode {
  type: 'emphasis';
  children: InlineNode[];
}

export interface StrongNode {
  type: 'strong';
  children: InlineNode[];
}

export interface InlineCodeNode {
  type: 'inlineCode';
  value: string;
}

export interface BreakNode {
  type: 'break';
}

export interface AuthorInfo {
  name: string;
  handle: string;
  avatarUrl?: string;
  verified?: boolean;
}

export interface MediaItem {
  kind: 'image' | 'video' | 'gif';
  url: string;
  posterUrl?: string;
  alt?: string;
}

export interface EngagementCounts {
  replies?: number;
  reposts?: number;
  likes?: number;
  bookmarks?: number;
  views?: number;
}
