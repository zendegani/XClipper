import type {
  Document,
  DocumentMetadata,
  TweetNode,
  ThreadNode,
  ArticleNode,
  Block,
  InlineNode,
  MediaItem,
  PollNode,
  LinkCardNode,
  ArticleCardNode,
  TableNode,
  TableCellNode,
} from './types';
import { isProgressiveMp4 } from './collect-media';

export interface MarkdownRenderOptions {
  includeVideoLinks?: boolean;
}

// AST → markdown body, matching the shape produced by the legacy Turndown
// pipeline (header + body + source footer). postProcess() then prepends YAML
// frontmatter and optionally strips the source footer.
//
// Goal: semantic parity with the existing .md fixtures. Where the AST encodes
// information the legacy pipeline lost (e.g. t.co → resolved URL), the
// renderer emits the AST-truthful form; those are justified diffs.
export function renderMarkdown(doc: Document, options: MarkdownRenderOptions = {}): string {
  const { body, metadata } = doc;
  const parts: string[] =
    body.type === 'tweet'   ? renderTweetDocument(body, metadata, options) :
    body.type === 'thread'  ? renderThreadDocument(body, metadata, options) :
    /* article */             renderArticleDocument(body, metadata, options);

  parts.push('', '---', '', `> Source: ${metadata.sourceUrl}`, `> Date: ${metadata.date}`);
  return parts.join('\n');
}

// Body content only — no author header and no Source/Date footer. The CSV
// `text` column uses this, since author / url / date already have their own
// columns; re-emitting them inside the text would be redundant.
export function renderMarkdownBody(doc: Document, options: MarkdownRenderOptions = {}): string {
  const { body } = doc;
  if (body.type === 'article') return renderArticleChildren(body.children, options);
  const parts: string[] = [];
  const tweets = body.type === 'thread' ? body.tweets : [body];
  tweets.forEach((tweet, idx) => {
    if (idx > 0) parts.push('', '---', '');
    appendTweetBody(parts, tweet, options);
  });
  return parts.join('\n').trim();
}

// ─── Document headers ───────────────────────────────────────────────

function tweetHeader(meta: DocumentMetadata): string {
  return `# ${meta.author.name} (@${meta.author.handle})`;
}

function renderTweetDocument(
  tweet: TweetNode,
  meta: DocumentMetadata,
  options: MarkdownRenderOptions,
): string[] {
  const parts: string[] = [tweetHeader(meta), ''];
  appendTweetBody(parts, tweet, options);
  return parts;
}

function renderThreadDocument(
  thread: ThreadNode,
  meta: DocumentMetadata,
  options: MarkdownRenderOptions,
): string[] {
  const parts: string[] = [tweetHeader(meta), ''];
  thread.tweets.forEach((tweet, idx) => {
    if (idx > 0) parts.push('', '---', '');
    appendTweetBody(parts, tweet, options);
  });
  return parts;
}

function renderArticleDocument(
  article: ArticleNode,
  meta: DocumentMetadata,
  options: MarkdownRenderOptions,
): string[] {
  const parts: string[] = [];
  if (meta.title) {
    parts.push(`# ${meta.title}`, '', `*By ${meta.author.name} (@${meta.author.handle})*`, '');
  } else {
    parts.push(`# Article by ${meta.author.name} (@${meta.author.handle})`, '');
  }
  if (article.banner) parts.push(`![Banner](${article.banner.url})`, '');
  const body = renderArticleChildren(article.children, options);
  if (body) parts.push(body);
  return parts;
}

// ─── Tweet body ─────────────────────────────────────────────────────

function appendTweetBody(
  parts: string[],
  tweet: TweetNode,
  options: MarkdownRenderOptions,
): void {
  const text = renderInlineForTweet(tweet.text);
  const mediaLines = tweet.media.map((media) => renderMediaItem(media, options));
  const embed = renderTweetEmbed(tweet, options);
  const pollLines = tweet.poll ? renderPoll(tweet.poll) : '';

  // Legacy layout: text + (poll appended to text) + media + embed.
  let body = text;
  if (pollLines) body += body ? `\n\n${pollLines}` : pollLines;
  if (body) parts.push(body);

  if (mediaLines.length > 0 && embed) {
    // Reading order: text → main media → embed. The legacy extractor inlines
    // media right before the embed when both are present.
    if (body) {
      const last = parts.pop() as string;
      parts.push(`${last}\n\n${mediaLines.join('\n')}${embed}`);
    } else {
      parts.push(`${mediaLines.join('\n')}${embed}`);
    }
  } else if (mediaLines.length > 0) {
    parts.push('', ...mediaLines);
  } else if (embed) {
    if (body) {
      const last = parts.pop() as string;
      parts.push(`${last}${embed}`);
    } else {
      parts.push(embed.replace(/^\n+/, ''));
    }
  }
}

function renderTweetEmbed(tweet: TweetNode, options: MarkdownRenderOptions): string {
  if (tweet.quotedTweet) return renderQuotedTweetBlock(tweet.quotedTweet, options);
  if (tweet.articleCard) return renderArticleCardBlock(tweet.articleCard);
  if (tweet.linkCard) return renderLinkCardBlock(tweet.linkCard);
  return '';
}

function renderQuotedTweetBlock(quote: TweetNode, options: MarkdownRenderOptions): string {
  const headerLine = `**${quote.author.name} (@${quote.author.handle})**`;
  const text = renderInlineForTweet(quote.text);
  const mediaLines = quote.media.map((media) => renderMediaItem(media, options));

  const segments: string[] = [headerLine];
  // Article-card quote: cover image + 📝 title + description, after the
  // author header. Matches the old Turndown rendering of an X article
  // embedded in a tweet quote. Note: each part becomes its own paragraph
  // inside the blockquote — keep newlines inside a part so the segment-
  // level `> ` wrapping below applies to wrapped description lines too.
  if (quote.articleCard) {
    const c = quote.articleCard;
    if (c.imageUrl) segments.push(`![Article cover](${c.imageUrl})`);
    segments.push(c.url ? `📝 [**${c.title}**](${c.url})` : `📝 **${c.title}**`);
    if (c.description) segments.push(c.description);
  }
  if (text) segments.push(text);
  if (mediaLines.length > 0) segments.push(mediaLines.join('\n'));

  const blockquoted = segments
    .map((seg) => seg.split('\n').map((l) => (l ? `> ${l}` : '> ')).join('\n'))
    .join('\n> \n');

  return `\n\n${blockquoted}`;
}

function renderLinkCardBlock(card: LinkCardNode): string {
  const parts: string[] = [];
  if (card.imageUrl) parts.push(`![Link card preview](${card.imageUrl})`);
  parts.push(card.url ? `🔗 [**${card.title}**](${card.url})` : `🔗 **${card.title}**`);
  if (card.description) parts.push(card.description);
  if (card.domain) parts.push(`_From ${card.domain}_`);
  const blockquoted = parts.map((p) => `> ${p}`).join('\n> \n');
  return `\n\n${blockquoted}`;
}

// Article card outside a quoted-tweet wrapper (tweet directly embedding an
// X article, no author header). Used by the tweet renderer's embed switch
// and as the block-level fallback in article body flow.
function renderArticleCardBlock(card: ArticleCardNode): string {
  const parts: string[] = [];
  if (card.imageUrl) parts.push(`![Article cover](${card.imageUrl})`);
  parts.push(card.url ? `📝 [**${card.title}**](${card.url})` : `📝 **${card.title}**`);
  if (card.description) parts.push(card.description);
  // Split each part on internal newlines so a multi-line description stays
  // inside the blockquote (legacy Turndown lost the `> ` prefix on wrapped
  // description lines; the AST-correct form keeps them).
  const blockquoted = parts
    .map((p) => p.split('\n').map((l) => (l ? `> ${l}` : '> ')).join('\n'))
    .join('\n> \n');
  return `\n\n${blockquoted}`;
}

function renderPoll(poll: PollNode): string {
  const lines = poll.choices.map((c) =>
    c.percent !== undefined ? `- ${c.label} — ${c.percent}%` : `- ${c.label}`
  );
  let out = `**Poll**\n${lines.join('\n')}`;
  if (poll.footer) out += `\n\n_${poll.footer}_`;
  return out;
}

function renderMediaItem(m: MediaItem, options: MarkdownRenderOptions): string {
  if (m.kind === 'video' || m.kind === 'gif') {
    const hasRealMp4 = m.url !== m.posterUrl && isProgressiveMp4(m.url);
    const videoLink = `[▶ ${m.kind === 'gif' ? 'GIF' : 'Video'}](${m.url})`;
    if (hasRealMp4 && options.includeVideoLinks && m.posterUrl) {
      return `![🎥 Video](${m.posterUrl})\n\n${videoLink}`;
    }
    if (hasRealMp4 && options.includeVideoLinks) return videoLink;
    if (m.posterUrl) return `![🎥 Video](${m.posterUrl})`;
    return '[🎥 Video]';
  }
  // Legacy pipeline always rendered "Image" as the alt for tweet photos,
  // discarding the DOM alt (which X populates with strings like "Image" or
  // "Embedded video" — UI sentinels, not user-authored alt text). The AST
  // preserves the truth; the renderer flattens for legacy parity.
  return `![Image](${m.url})`;
}

// ─── Inline rendering (tweet context) ───────────────────────────────

function renderInlineForTweet(nodes: InlineNode[]): string {
  return renderInlineNodes(nodes, 'tweet');
}

function renderInlineForArticle(nodes: InlineNode[]): string {
  return renderInlineNodes(nodes, 'article');
}

type InlineContext = 'tweet' | 'article';

function renderInlineNodes(nodes: InlineNode[], ctx: InlineContext): string {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'break') {
      // Consecutive breaks become a paragraph break with the legacy
      // trailing-spaces pattern. A single break is a hard line break.
      let runs = 1;
      while (nodes[i + 1]?.type === 'break') { runs++; i++; }
      out += runs >= 2 ? '  \n  \n' : '  \n';
      continue;
    }
    out += renderInline(n, ctx);
  }
  return out;
}

function stripSchemeIfMatchingHref(display: string, url: string): string {
  const m = display.match(/^https?:\/\/(.+)$/);
  if (!m) return display;
  const bare = m[1];
  return url === display || url === `https://${bare}` ? bare : display;
}

function renderInline(node: InlineNode, ctx: InlineContext): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'break':
      return '  \n';
    case 'entity':
      if (ctx === 'article') {
        const sigil = node.kind === 'mention' ? '@' : node.kind === 'hashtag' ? '#' : '$';
        // Article context preserves links for entities (Turndown emitted them).
        // Mention links are written with the bare @ prefix on the URL path.
        const url = node.kind === 'mention' ? `https://x.com/@${node.value}` : node.url;
        return `[${sigil}${node.value}](${url})`;
      }
      // Tweet context: bare sigil + value (legacy pipeline dropped the link).
      if (node.kind === 'mention') return `@${node.value}`;
      if (node.kind === 'hashtag') return `#${node.value}`;
      return `$${node.value}`;
    case 'link': {
      const text = renderInlineNodes(node.children, ctx);
      // When the display text is a URL and equals the link's URL after the
      // scheme is normalized, render without the scheme — matches the legacy
      // pipeline's display style (X shows "goo.gle/abc" not "https://…").
      const display = stripSchemeIfMatchingHref(text, node.url);
      return `[${display}](${node.url})`;
    }
    case 'strong':
      return wrapEmphasis(renderInlineNodes(node.children, ctx), '**');
    case 'emphasis':
      return wrapEmphasis(renderInlineNodes(node.children, ctx), '*');
    case 'inlineCode':
      return `\`${node.value}\``;
  }
}

// X authors routinely style the trailing space of a run ("Best used for: "),
// so the AST faithfully carries whitespace inside the emphasis. Markdown can't:
// a closing delimiter preceded by whitespace isn't a delimiter at all, so
// `**Best used for: **` renders as literal asterisks. Hoist edge whitespace
// outside the markers; drop the markers when there's nothing visible left to
// emphasize — X ends some article paragraphs with a bold zero-width joiner,
// and a bold joiner is just two pairs of asterisks on screen. The invisible
// characters themselves are kept: the AST says the author typed them.
function wrapEmphasis(inner: string, marker: string): string {
  const lead = inner.match(/^\s*/)![0];
  const trail = inner.slice(lead.length).match(/\s*$/)![0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  const visible = core.replace(/[\u200b-\u200d\u2060\ufeff]/g, '');
  return visible ? `${lead}${marker}${core}${marker}${trail}` : inner;
}

// ─── Article body ───────────────────────────────────────────────────

function renderArticleChildren(blocks: Block[], options: MarkdownRenderOptions): string {
  const out: string[] = [];
  for (const block of blocks) {
    const md = renderArticleBlock(block, options);
    if (md) out.push(md);
  }
  // Collapse runs of 3+ blank lines (legacy pipeline does the same).
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderArticleBlock(block: Block, options: MarkdownRenderOptions): string {
  switch (block.type) {
    case 'paragraph':
      return renderInlineForArticle(block.children);
    case 'heading':
      return `${'#'.repeat(block.depth)} ${renderInlineForArticle(block.children)}`;
    case 'list': {
      const lines = block.children.map((item, i) => {
        const bullet = block.ordered ? `${i + 1}. ` : '- ';
        const inner = item.children
          .map((b) => (b.type === 'paragraph' ? renderInlineForArticle(b.children) : renderArticleBlock(b, options)))
          .join('\n');
        return `${bullet}${inner}`;
      });
      return lines.join('\n');
    }
    case 'code':
      return `\`\`\`${block.lang ?? ''}\n${block.value}\n\`\`\``;
    case 'image':
      return `![${block.alt ?? 'Image'}](${block.url})`;
    case 'thematicBreak':
      return '---';
    case 'table':
      return renderTable(block);
    case 'blockquote':
      return block.children
        .map((child) => renderArticleBlock(child, options))
        .join('\n\n')
        .split('\n').map((l) => `> ${l}`).join('\n');
    case 'video':
      return renderMediaItem({
        kind: 'video',
        url: block.sourceUrl,
        ...(block.posterUrl !== undefined ? { posterUrl: block.posterUrl } : {}),
      }, options);
    case 'articleCard':
      // In article body flow the card is the whole block — render it as a
      // blockquote stanza, same shape as the in-tweet form.
      return renderArticleCardBlock(block).replace(/^\n\n/, '');
    case 'tweet':
      return renderQuotedTweetBlock(block, options).replace(/^\n\n/, '');
    default:
      return '';
  }
}

// GFM table. The header row is required by the syntax, so a headerless table
// gets an empty one — losing the borders is better than losing the rows.
function renderTable(table: TableNode): string {
  const width = Math.max(
    table.header?.children.length ?? 0,
    ...table.children.map((r) => r.children.length),
    1
  );
  const row = (cells: string[]): string => {
    const padded = [...cells, ...Array(width - cells.length).fill('')];
    return `| ${padded.join(' | ')} |`;
  };
  const lines = [
    row((table.header?.children ?? []).map(renderTableCell)),
    row(Array(width).fill('---')),
    ...table.children.map((r) => row(r.children.map(renderTableCell))),
  ];
  return lines.join('\n');
}

// A cell is a single line: hard breaks become spaces, and a literal pipe
// would otherwise end the cell early. Backslashes are escaped first — escaping
// only the pipe turns the author's `\` + `|` into `\\|`, which markdown reads
// as an escaped backslash followed by a live pipe, splitting the row.
function renderTableCell(cell: TableCellNode): string {
  return renderInlineForArticle(cell.children)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .trim();
}
