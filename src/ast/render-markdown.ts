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
} from './types';

// AST → markdown body, matching the shape produced by the legacy Turndown
// pipeline (header + body + source footer). postProcess() then prepends YAML
// frontmatter and optionally strips the source footer.
//
// Goal: semantic parity with the existing .md fixtures. Where the AST encodes
// information the legacy pipeline lost (e.g. t.co → resolved URL), the
// renderer emits the AST-truthful form; those are justified diffs.
export function renderMarkdown(doc: Document): string {
  const { body, metadata } = doc;
  const parts: string[] =
    body.type === 'tweet'   ? renderTweetDocument(body, metadata) :
    body.type === 'thread'  ? renderThreadDocument(body, metadata) :
    /* article */             renderArticleDocument(body, metadata);

  parts.push('', '---', '', `> Source: ${metadata.sourceUrl}`, `> Date: ${metadata.date}`);
  return parts.join('\n');
}

// ─── Document headers ───────────────────────────────────────────────

function tweetHeader(meta: DocumentMetadata): string {
  return `# ${meta.author.name} (@${meta.author.handle})`;
}

function renderTweetDocument(tweet: TweetNode, meta: DocumentMetadata): string[] {
  const parts: string[] = [tweetHeader(meta), ''];
  appendTweetBody(parts, tweet);
  return parts;
}

function renderThreadDocument(thread: ThreadNode, meta: DocumentMetadata): string[] {
  const parts: string[] = [tweetHeader(meta), ''];
  thread.tweets.forEach((tweet, idx) => {
    if (idx > 0) parts.push('', '---', '');
    appendTweetBody(parts, tweet);
  });
  return parts;
}

function renderArticleDocument(article: ArticleNode, meta: DocumentMetadata): string[] {
  const parts: string[] = [];
  if (meta.title) {
    parts.push(`# ${meta.title}`, '', `*By ${meta.author.name} (@${meta.author.handle})*`, '');
  } else {
    parts.push(`# Article by ${meta.author.name} (@${meta.author.handle})`, '');
  }
  if (article.banner) parts.push(`![Banner](${article.banner.url})`, '');
  const body = renderArticleChildren(article.children);
  if (body) parts.push(body);
  return parts;
}

// ─── Tweet body ─────────────────────────────────────────────────────

function appendTweetBody(parts: string[], tweet: TweetNode): void {
  const text = renderInlineForTweet(tweet.text);
  const mediaLines = tweet.media.map(renderMediaItem);
  const embed = renderTweetEmbed(tweet);
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

function renderTweetEmbed(tweet: TweetNode): string {
  if (tweet.quotedTweet) return renderQuotedTweetBlock(tweet.quotedTweet);
  if (tweet.linkCard) return renderLinkCardBlock(tweet.linkCard);
  return '';
}

function renderQuotedTweetBlock(quote: TweetNode): string {
  const headerLine = `**${quote.author.name} (@${quote.author.handle})**`;
  const text = renderInlineForTweet(quote.text);
  const mediaLines = quote.media.map(renderMediaItem);

  const segments: string[] = [headerLine];
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

function renderPoll(poll: PollNode): string {
  const lines = poll.choices.map((c) =>
    c.percent !== undefined ? `- ${c.label} — ${c.percent}%` : `- ${c.label}`
  );
  let out = `**Poll**\n${lines.join('\n')}`;
  if (poll.footer) out += `\n\n_${poll.footer}_`;
  return out;
}

function renderMediaItem(m: MediaItem): string {
  if (m.kind === 'video' || m.kind === 'gif') {
    return `![🎥 Video](${m.posterUrl ?? m.url})`;
  }
  const alt = m.alt || 'Image';
  return `![${alt}](${m.url})`;
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
    case 'link':
      return `[${renderInlineNodes(node.children, ctx)}](${node.url})`;
    case 'strong':
      return `**${renderInlineNodes(node.children, ctx)}**`;
    case 'emphasis':
      return `*${renderInlineNodes(node.children, ctx)}*`;
    case 'inlineCode':
      return `\`${node.value}\``;
  }
}

// ─── Article body ───────────────────────────────────────────────────

function renderArticleChildren(blocks: Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    const md = renderArticleBlock(block);
    if (md) out.push(md);
  }
  // Collapse runs of 3+ blank lines (legacy pipeline does the same).
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderArticleBlock(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return renderInlineForArticle(block.children);
    case 'heading':
      return `${'#'.repeat(block.depth)} ${renderInlineForArticle(block.children)}`;
    case 'list': {
      const lines = block.children.map((item, i) => {
        const bullet = block.ordered ? `${i + 1}. ` : '- ';
        const inner = item.children
          .map((b) => (b.type === 'paragraph' ? renderInlineForArticle(b.children) : renderArticleBlock(b)))
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
    case 'blockquote':
      return block.children
        .map(renderArticleBlock)
        .join('\n\n')
        .split('\n').map((l) => `> ${l}`).join('\n');
    case 'video':
      return `![🎥 Video](${block.posterUrl})`;
    default:
      return '';
  }
}
