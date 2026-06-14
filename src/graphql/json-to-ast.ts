// Fast Batch (ADR 0003): map X's internal GraphQL tweet JSON → the Content AST.
//
// This is a sibling to src/content/dom-to-ast: it produces the SAME `Document`
// the renderers consume, so every renderer, postProcess, format, and sink works
// unchanged. It depends only on the JSON shape — no DOM, no Chrome APIs — so it
// is pure and unit-testable.
//
// ⚠️ The field paths below are MODELED ON X's documented GraphQL schema
// (`tweet_results.result.legacy` + siblings) and validated only against the
// hand-written fixtures in tests/. They MUST be re-checked against a REAL
// captured response (needs a logged-in session) before the fetch layer is
// trusted — see ADR 0003 "Build order within Phase 1". Reading is deliberately
// defensive (optional chaining, both old/new field locations) for that reason.

import type {
  ArticleNode,
  AuthorInfo,
  Block,
  Document,
  EngagementCounts,
  HeadingNode,
  ImageNode,
  InlineNode,
  LinkCardNode,
  ListItemNode,
  ListNode,
  MediaItem,
  PollNode,
  TweetNode,
} from '../ast/types';

// ─── Raw JSON shapes (the subset we read) ───────────────────────────

interface RawUser {
  // Newer schema moved name/screen_name to `core`; older keeps them in `legacy`.
  core?: { name?: string; screen_name?: string };
  legacy?: { name?: string; screen_name?: string; verified?: boolean; profile_image_url_https?: string };
  avatar?: { image_url?: string };
  is_blue_verified?: boolean;
}

interface RawIndexed {
  indices?: [number, number];
}
interface RawUrlEntity extends RawIndexed {
  url?: string;
  expanded_url?: string;
  display_url?: string;
}
interface RawMentionEntity extends RawIndexed {
  screen_name?: string;
}
interface RawTagEntity extends RawIndexed {
  text?: string;
}
interface RawEntities {
  urls?: RawUrlEntity[];
  user_mentions?: RawMentionEntity[];
  hashtags?: RawTagEntity[];
  symbols?: RawTagEntity[];
  media?: (RawIndexed & { url?: string })[];
}

interface RawMedia {
  type?: string; // 'photo' | 'video' | 'animated_gif'
  media_url_https?: string;
  ext_alt_text?: string | null;
  video_info?: { variants?: { bitrate?: number; content_type?: string; url?: string }[] };
}

interface RawBinding {
  key?: string;
  value?: { type?: string; string_value?: string; image_value?: { url?: string } };
}
interface RawCard {
  legacy?: { name?: string; binding_values?: RawBinding[] };
}

interface RawLegacy {
  id_str?: string;
  created_at?: string;
  full_text?: string;
  entities?: RawEntities;
  extended_entities?: { media?: RawMedia[] };
  favorite_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  bookmark_count?: number;
}

interface RawTweet {
  rest_id?: string;
  core?: { user_results?: { result?: RawUser } };
  legacy?: RawLegacy;
  // Long-form (>280) tweets: `text` is the FULL untruncated body and
  // `entity_set` holds entities whose indices align with that full text.
  // legacy.full_text/entities are the truncated form — never mix the two.
  note_tweet?: { note_tweet_results?: { result?: { text?: string; entity_set?: RawEntities } } };
  quoted_status_result?: { result?: RawResult };
  card?: RawCard;
  views?: { count?: string };
  // X long-form Article. The bookmarks/timeline response carries only title +
  // preview_text + cover (no full body), so we map a labelled stub here; the
  // full body needs a separate article-content fetch (ADR 0003 Phase 3).
  article?: { article_results?: { result?: RawArticle } };
}

interface RawArticle {
  rest_id?: string;
  title?: string;
  preview_text?: string;
  cover_media?: { media_info?: { original_img_url?: string } };
  // TweetDetail carries the full body as a Draft.js content_state; the
  // bookmarks/timeline response omits it (→ preview stub). media_entities
  // resolves an atomic block's MEDIA entity to an image URL.
  content_state?: RawContentState;
  media_entities?: RawMediaEntity[];
}

// ─── Draft.js content_state (X Article full body) ───────────────────
interface RawDraftRange {
  offset?: number;
  length?: number;
}
interface RawStyleRange extends RawDraftRange {
  style?: string; // 'Bold' | 'Italic' (others ignored)
}
interface RawEntityRange extends RawDraftRange {
  key?: number | string; // indexes entityMap by stringified key
}
interface RawDraftBlock {
  type?: string; // unstyled | header-one|two | unordered/ordered-list-item | atomic
  text?: string;
  inlineStyleRanges?: RawStyleRange[];
  entityRanges?: RawEntityRange[];
}
interface RawEntityValue {
  type?: string; // 'LINK' | 'MEDIA'
  data?: { url?: string; mediaItems?: { mediaId?: string }[] };
}
interface RawContentState {
  blocks?: RawDraftBlock[];
  entityMap?: { key?: number | string; value?: RawEntityValue }[];
}
interface RawMediaEntity {
  media_id?: string;
  media_info?: { original_img_url?: string };
}

// A timeline entry's tweet may be wrapped (e.g. TweetWithVisibilityResults).
interface RawResult extends RawTweet {
  __typename?: string;
  tweet?: RawTweet;
}

// ─── Entry points ───────────────────────────────────────────────────

export function jsonToAst(raw: unknown, sourceUrl?: string): Document {
  const t = unwrap(raw);
  const article = t.article?.article_results?.result;
  if (article) return articleDocument(t, article, sourceUrl);

  const tweet = jsonToTweetNode(raw);
  return {
    version: 1,
    metadata: {
      type: 'tweet',
      sourceUrl: sourceUrl ?? `https://x.com/${tweet.author.handle}/status/${tweet.tweetId}`,
      tweetId: tweet.tweetId,
      author: tweet.author,
      date: tweet.date,
      ...(tweet.engagement ? { engagement: tweet.engagement } : {}),
    },
    body: tweet,
  };
}

// X long-form Article. TweetDetail carries the full body as a Draft.js
// content_state, which we map to article blocks (the same shape the DOM
// extractor produces). The bookmarks/timeline response omits the body, so there
// we fall back to a faithful *stub*: title + cover + preview + a "read on X"
// link — honest, and far better than mislabeling it a tweet.
function articleDocument(t: RawTweet, article: RawArticle, sourceUrl?: string): Document {
  const tweetId = t.rest_id ?? t.legacy?.id_str ?? '';
  const url =
    t.legacy?.entities?.urls?.[0]?.expanded_url?.replace(/^http:/, 'https:') ??
    `https://x.com/i/article/${article.rest_id ?? tweetId}`;

  const blocks = article.content_state?.blocks ?? [];
  const children: Block[] = blocks.length
    ? draftToBlocks(article.content_state ?? {}, article.media_entities ?? [])
    : stubChildren(article, url);

  const body: ArticleNode = { type: 'article', children };
  const cover = article.cover_media?.media_info?.original_img_url;
  if (cover) body.banner = { type: 'image', url: cover };

  const eng = engagement(t);
  return {
    version: 1,
    metadata: {
      type: 'article',
      sourceUrl: sourceUrl ?? url,
      tweetId,
      author: author(t),
      date: toIso(t.legacy?.created_at),
      title: (article.title ?? '').trim(),
      ...(eng ? { engagement: eng } : {}),
    },
    body,
  };
}

function stubChildren(article: RawArticle, url: string): Block[] {
  const children: Block[] = [];
  if (article.preview_text) {
    children.push({ type: 'paragraph', children: [{ type: 'text', value: article.preview_text }] });
  }
  children.push({
    type: 'paragraph',
    children: [{ type: 'link', url, children: [{ type: 'text', value: 'Read the full article on X' }] }],
  });
  return children;
}

// ─── Draft.js content_state → article body blocks ───────────────────
//
// X stores the Article body as a Draft.js raw content state: a flat list of
// blocks (paragraph/header/list-item/atomic), an entityMap (LINK + MEDIA), and
// per-block style ranges. Offsets are UTF-16 code-unit based (Draft.js native),
// so plain string slicing is correct here. We emit the SAME block shapes the DOM
// article extractor produces, so the renderers are unchanged.

function draftToBlocks(cs: RawContentState, mediaEntities: RawMediaEntity[]): Block[] {
  const entities = new Map<string, RawEntityValue>();
  for (const e of cs.entityMap ?? []) if (e.key != null && e.value) entities.set(String(e.key), e.value);
  const mediaById = new Map<string, RawMediaEntity>();
  for (const m of mediaEntities) if (m.media_id) mediaById.set(m.media_id, m);

  const out: Block[] = [];
  let list: ListNode | null = null;
  const flushList = (): void => {
    if (list) {
      out.push(list);
      list = null;
    }
  };

  for (const b of cs.blocks ?? []) {
    const type = b.type ?? 'unstyled';

    if (type === 'unordered-list-item' || type === 'ordered-list-item') {
      const ordered = type === 'ordered-list-item';
      const inline = draftInline(b, entities);
      if (inline.length === 0) continue;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: 'list', ordered, children: [] };
      }
      const item: ListItemNode = { type: 'listItem', children: [{ type: 'paragraph', children: inline }] };
      list.children.push(item);
      continue;
    }

    flushList();

    if (type === 'atomic') {
      const img = atomicImage(b, entities, mediaById);
      if (img) out.push(img);
      continue;
    }

    if (type === 'header-one' || type === 'header-two' || type === 'header-three') {
      const inline = draftInline(b, entities);
      if (inline.length === 0) continue;
      const depth = type === 'header-one' ? 1 : type === 'header-two' ? 2 : 3;
      out.push({ type: 'heading', depth, children: inline } satisfies HeadingNode);
      continue;
    }

    // unstyled (and any unknown block) → paragraph; skip empty spacer blocks.
    const inline = draftInline(b, entities);
    if (inline.length) out.push({ type: 'paragraph', children: inline });
  }
  flushList();
  return out;
}

// An atomic block holds a single MEDIA entity; resolve it to an image URL via
// media_entities (keyed by mediaId).
function atomicImage(
  b: RawDraftBlock,
  entities: Map<string, RawEntityValue>,
  mediaById: Map<string, RawMediaEntity>
): ImageNode | undefined {
  const range = (b.entityRanges ?? [])[0];
  if (!range || range.key == null) return undefined;
  const ent = entities.get(String(range.key));
  if (ent?.type !== 'MEDIA') return undefined;
  const mediaId = ent.data?.mediaItems?.[0]?.mediaId;
  if (!mediaId) return undefined;
  const url = mediaById.get(mediaId)?.media_info?.original_img_url;
  return url ? { type: 'image', url } : undefined;
}

// Build inline nodes for one Draft block: walk character runs that share the
// same Bold/Italic styling and LINK entity, then wrap each run (emphasis inside
// strong inside link). Soft newlines within a block become break nodes.
function draftInline(b: RawDraftBlock, entities: Map<string, RawEntityValue>): InlineNode[] {
  const text = b.text ?? '';
  const n = text.length;
  if (n === 0) return [];

  const bold = new Array<boolean>(n).fill(false);
  const italic = new Array<boolean>(n).fill(false);
  const link = new Array<string | null>(n).fill(null);

  for (const s of b.inlineStyleRanges ?? []) {
    const start = s.offset ?? 0;
    const stop = Math.min(start + (s.length ?? 0), n);
    for (let i = start; i < stop; i++) {
      if (s.style === 'Bold') bold[i] = true;
      else if (s.style === 'Italic') italic[i] = true;
    }
  }
  for (const r of b.entityRanges ?? []) {
    if (r.key == null) continue;
    const ent = entities.get(String(r.key));
    if (ent?.type !== 'LINK' || !ent.data?.url) continue;
    const start = r.offset ?? 0;
    const stop = Math.min(start + (r.length ?? 0), n);
    for (let i = start; i < stop; i++) link[i] = ent.data.url;
  }

  const out: InlineNode[] = [];
  let i = 0;
  while (i < n) {
    const b0 = bold[i];
    const it0 = italic[i];
    const ln0 = link[i];
    let j = i + 1;
    while (j < n && bold[j] === b0 && italic[j] === it0 && link[j] === ln0) j++;
    out.push(...wrapRun(text.slice(i, j), b0, it0, ln0));
    i = j;
  }
  return out;
}

function wrapRun(seg: string, bold: boolean, italic: boolean, url: string | null): InlineNode[] {
  const base: InlineNode[] = [];
  const parts = seg.split('\n');
  for (let k = 0; k < parts.length; k++) {
    if (k > 0) base.push({ type: 'break' });
    if (parts[k]) base.push({ type: 'text', value: parts[k] });
  }
  if (base.length === 0) return [];
  let nodes = base;
  if (italic) nodes = [{ type: 'emphasis', children: nodes }];
  if (bold) nodes = [{ type: 'strong', children: nodes }];
  if (url) nodes = [{ type: 'link', url, children: nodes }];
  return nodes;
}

export function jsonToTweetNode(raw: unknown): TweetNode {
  const t = unwrap(raw);
  const legacy = t.legacy ?? {};
  // Long-form tweets carry the full body + matching entities under note_tweet;
  // fall back to the truncated legacy pair. The text and the entities used to
  // splice it MUST come from the same source so indices line up.
  const note = t.note_tweet?.note_tweet_results?.result;
  const text =
    note?.text !== undefined
      ? buildInline(note.text, note.entity_set ?? {})
      : buildInline(legacy.full_text ?? '', legacy.entities ?? {});

  const node: TweetNode = {
    type: 'tweet',
    author: author(t),
    date: toIso(legacy.created_at),
    tweetId: t.rest_id ?? legacy.id_str ?? '',
    text,
    media: media(legacy.extended_entities?.media ?? []),
  };

  const eng = engagement(t);
  if (eng) node.engagement = eng;

  const card = fromCard(t.card);
  if (card?.kind === 'poll') node.poll = card.poll;
  if (card?.kind === 'link') node.linkCard = card.linkCard;

  const quoted = t.quoted_status_result?.result;
  if (quoted) node.quotedTweet = jsonToTweetNode(quoted);

  return node;
}

// ─── Helpers ────────────────────────────────────────────────────────

function unwrap(raw: unknown): RawResult {
  const r = (raw ?? {}) as RawResult;
  // TweetWithVisibilityResults (and similar) nest the real tweet under `tweet`.
  return r.tweet ? { ...r.tweet } : r;
}

function author(t: RawTweet): AuthorInfo {
  const u = t.core?.user_results?.result ?? {};
  const name = u.core?.name ?? u.legacy?.name ?? '';
  const handle = u.core?.screen_name ?? u.legacy?.screen_name ?? '';
  const info: AuthorInfo = { name, handle };
  const avatar = u.legacy?.profile_image_url_https ?? u.avatar?.image_url;
  if (avatar) info.avatarUrl = avatar;
  if (u.is_blue_verified || u.legacy?.verified) info.verified = true;
  return info;
}

function toIso(created?: string): string {
  if (!created) return '';
  const d = new Date(created);
  return Number.isNaN(d.getTime()) ? created : d.toISOString();
}

function engagement(t: RawTweet): EngagementCounts | undefined {
  const l = t.legacy ?? {};
  const out: EngagementCounts = {};
  if (l.reply_count !== undefined) out.replies = l.reply_count;
  if (l.retweet_count !== undefined) out.reposts = l.retweet_count;
  if (l.favorite_count !== undefined) out.likes = l.favorite_count;
  if (l.bookmark_count !== undefined) out.bookmarks = l.bookmark_count;
  const views = t.views?.count;
  if (views !== undefined) out.views = Number(views);
  return Object.keys(out).length > 0 ? out : undefined;
}

function media(items: RawMedia[]): MediaItem[] {
  const out: MediaItem[] = [];
  for (const m of items) {
    const alt = m.ext_alt_text || undefined;
    if (m.type === 'photo') {
      if (m.media_url_https) out.push({ kind: 'image', url: m.media_url_https, ...(alt ? { alt } : {}) });
    } else if (m.type === 'video' || m.type === 'animated_gif') {
      const src = bestVariant(m.video_info?.variants ?? []);
      if (src) {
        out.push({
          kind: m.type === 'animated_gif' ? 'gif' : 'video',
          url: src,
          ...(m.media_url_https ? { posterUrl: m.media_url_https } : {}),
          ...(alt ? { alt } : {}),
        });
      }
    }
  }
  return out;
}

// Highest-bitrate progressive MP4 (X also ships HLS .m3u8 variants with no
// bitrate, which a downloader can't save directly — prefer the mp4s).
function bestVariant(variants: { bitrate?: number; content_type?: string; url?: string }[]): string | undefined {
  const mp4 = variants.filter((v) => v.content_type === 'video/mp4' && v.url);
  if (mp4.length === 0) return variants.find((v) => v.url)?.url;
  return mp4.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0].url;
}

type CardResult =
  | { kind: 'poll'; poll: PollNode }
  | { kind: 'link'; linkCard: LinkCardNode }
  | undefined;

function fromCard(card?: RawCard): CardResult {
  const name = card?.legacy?.name ?? '';
  const get = (key: string): string | undefined => {
    const b = card?.legacy?.binding_values?.find((v) => v.key === key)?.value;
    return b?.string_value ?? b?.image_value?.url;
  };
  if (/poll\d/.test(name)) {
    const choices: PollNode['choices'] = [];
    const counts: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const label = get(`choice${i}_label`);
      if (label === undefined) break;
      choices.push({ label });
      counts.push(Number(get(`choice${i}_count`) ?? 0));
    }
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > 0) {
      choices.forEach((c, i) => {
        c.percent = Math.round((counts[i] / total) * 100);
      });
    }
    return { kind: 'poll', poll: { type: 'poll', choices } };
  }
  if (/summary/.test(name)) {
    const title = get('title');
    if (!title) return undefined;
    const link: LinkCardNode = { type: 'linkCard', url: get('card_url') ?? '', title };
    const description = get('description');
    if (description) link.description = description;
    const image = get('thumbnail_image_large') ?? get('thumbnail_image') ?? get('photo_image_full_size_large');
    if (image) link.imageUrl = image;
    const domain = get('domain') ?? get('vanity_url');
    if (domain) link.domain = domain;
    return { kind: 'link', linkCard: link };
  }
  return undefined;
}

// ─── Inline text from full_text + entity indices ────────────────────
//
// Twitter entity `indices` are codepoint offsets over the tweet text, so we
// splice over an Array.from() codepoint array (handles emoji surrogate pairs).
// Each entity range becomes a node; gaps become text (newlines → break nodes);
// the trailing media t.co link is dropped (media is carried structurally).

interface Span {
  start: number;
  end: number;
  node: InlineNode | null; // null = drop this range (media link)
}

function buildInline(text: string, entities: RawEntities): InlineNode[] {
  const cp = Array.from(text);
  const spans: Span[] = [];

  for (const u of entities.urls ?? []) {
    if (!u.indices) continue;
    const url = u.expanded_url ?? u.url ?? '';
    spans.push({
      start: u.indices[0],
      end: u.indices[1],
      node: { type: 'link', url, children: [{ type: 'text', value: u.display_url ?? url }] },
    });
  }
  for (const m of entities.user_mentions ?? []) {
    if (!m.indices || !m.screen_name) continue;
    spans.push({
      start: m.indices[0],
      end: m.indices[1],
      node: { type: 'entity', kind: 'mention', value: m.screen_name, url: `https://x.com/${m.screen_name}` },
    });
  }
  for (const h of entities.hashtags ?? []) {
    if (!h.indices || !h.text) continue;
    spans.push({
      start: h.indices[0],
      end: h.indices[1],
      node: { type: 'entity', kind: 'hashtag', value: h.text, url: `https://x.com/hashtag/${h.text}` },
    });
  }
  for (const s of entities.symbols ?? []) {
    if (!s.indices || !s.text) continue;
    spans.push({
      start: s.indices[0],
      end: s.indices[1],
      node: { type: 'entity', kind: 'cashtag', value: s.text, url: `https://x.com/search?q=%24${s.text}` },
    });
  }
  for (const m of entities.media ?? []) {
    if (!m.indices) continue;
    spans.push({ start: m.indices[0], end: m.indices[1], node: null });
  }

  spans.sort((a, b) => a.start - b.start);

  const out: InlineNode[] = [];
  let cursor = 0;
  const pushText = (from: number, to: number): void => {
    if (to <= from) return;
    pushTextValue(out, unescapeHtml(cp.slice(from, to).join('')));
  };
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping entity — skip
    pushText(cursor, span.start);
    if (span.node) out.push(span.node);
    cursor = span.end;
  }
  pushText(cursor, cp.length);

  return trimEdges(out);
}

// Push a text run, splitting newlines into break nodes (matching the DOM walker).
function pushTextValue(out: InlineNode[], value: string): void {
  const parts = value.split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out.push({ type: 'break' });
    if (parts[i]) out.push({ type: 'text', value: parts[i] });
  }
}

// Drop leading/trailing break nodes, then strip whitespace at the very start
// and end (e.g. the space left where a trailing media link was removed) so the
// rendered text doesn't carry stray edge whitespace — matching the DOM path.
function trimEdges(nodes: InlineNode[]): InlineNode[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start].type === 'break') start++;
  while (end > start && nodes[end - 1].type === 'break') end--;
  const out = nodes.slice(start, end);
  const first = out[0];
  if (first?.type === 'text') out[0] = { type: 'text', value: first.value.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.type === 'text') out[out.length - 1] = { type: 'text', value: last.value.replace(/\s+$/, '') };
  return out.filter((n) => n.type !== 'text' || n.value !== '');
}

// X HTML-escapes &, <, > in tweet text; the DOM path reads textContent (already
// decoded), so decode here to match.
function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
