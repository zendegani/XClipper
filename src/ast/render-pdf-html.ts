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
} from './types';

export interface RenderPdfHtmlOptions {
  // 'twitter' (default): X-styled cards. 'document': clean prose layout.
  // Only 'twitter' is implemented in v1; the option exists so the future
  // 'document' style is additive without API churn.
  style?: 'twitter' | 'document';
  // When true, engagement metrics (likes, reposts, etc.) are rendered on
  // tweet cards. Defaults to false — callers must opt in.
  includeEngagement?: boolean;
}

// AST → standalone HTML document for PDF rendering. Used by tests and any
// future preview-page flow. All visual styles are scoped under .xclipper-root so
// the same content can also be safely injected as a fragment into a live
// page (see renderPdfFragment + pdf-export.ts).
export function renderPdfHtml(doc: Document, opts: RenderPdfHtmlOptions = {}): string {
  const body = renderBody(doc, opts);
  const title = doc.metadata.title || tweetTitle(doc.metadata);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${STYLES}</style></head><body><div class="xclipper-root">${body}</div></body></html>`;
}

// Fragment variant for live-DOM injection: returns `<style>…<div class="xclipper-root">…</div>`
// so the caller can set it as innerHTML of an offscreen container without
// polluting page styles (all selectors are scoped to .xclipper-root).
export function renderPdfFragment(doc: Document, opts: RenderPdfHtmlOptions = {}): string {
  return `<style>${STYLES}</style><div class="xclipper-root">${renderBody(doc, opts)}</div>`;
}

function tweetTitle(meta: DocumentMetadata): string {
  const noun = meta.type === 'thread' ? 'Thread' : 'Post';
  return `${noun} by @${meta.author.handle}`;
}

// ─── Top-level body ─────────────────────────────────────────────────

function renderBody(doc: Document, opts: RenderPdfHtmlOptions = {}): string {
  if (doc.body.type === 'tweet') return renderTweetCard(doc.body, doc.metadata, opts);
  if (doc.body.type === 'thread') return renderThread(doc.body, doc.metadata, opts);
  return renderArticle(doc.body, doc.metadata, opts);
}

function renderThread(thread: ThreadNode, meta: DocumentMetadata, opts: RenderPdfHtmlOptions = {}): string {
  const cards = thread.tweets.map((t, i) => {
    const isRoot = i === 0;
    return renderTweetCard(t, isRoot ? meta : undefined, opts);
  }).join('');
  return `<div class="thread">${cards}</div>` + renderSource(meta);
}

function renderTweetCard(tweet: TweetNode, meta?: DocumentMetadata, opts: RenderPdfHtmlOptions = {}): string {
  const head = renderAuthorHeader(tweet);
  const text = tweet.text.length > 0
    ? `<div class="tweet-body">${renderInlines(tweet.text)}</div>`
    : '';
  const media = tweet.media.length > 0
    ? `<div class="tweet-media">${tweet.media.map(renderMedia).join('')}</div>`
    : '';
  const poll = tweet.poll ? renderPoll(tweet.poll) : '';
  const linkCard = tweet.linkCard ? renderLinkCard(tweet.linkCard) : '';
  const articleCard = tweet.articleCard ? renderArticleCard(tweet.articleCard) : '';
  const quote = tweet.quotedTweet ? renderQuotedTweet(tweet.quotedTweet) : '';
  const engagement = opts.includeEngagement && tweet.engagement
    ? renderEngagement(tweet.engagement)
    : '';
  const source = meta ? renderSource(meta) : '';
  return `<article class="tweet-card">${head}${text}${media}${poll}${linkCard}${articleCard}${quote}${engagement}${source}</article>`;
}

function renderQuotedTweet(quote: TweetNode): string {
  const head = renderAuthorHeader(quote);
  const text = quote.text.length > 0
    ? `<div class="tweet-body">${renderInlines(quote.text)}</div>`
    : '';
  const media = quote.media.length > 0
    ? `<div class="tweet-media">${quote.media.map(renderMedia).join('')}</div>`
    : '';
  const articleCard = quote.articleCard ? renderArticleCard(quote.articleCard) : '';
  return `<aside class="tweet-card is-quote">${head}${text}${media}${articleCard}</aside>`;
}

function renderAuthorHeader(tweet: TweetNode): string {
  const avatar = tweet.author.avatarUrl
    ? `<img class="avatar" src="${escapeAttr(tweet.author.avatarUrl)}" alt="">`
    : `<div class="avatar avatar-placeholder">${escapeHtml((tweet.author.name[0] || '?').toUpperCase())}</div>`;
  const verified = tweet.author.verified ? '<span class="verified" aria-label="Verified">✓</span>' : '';
  const date = tweet.date ? formatDate(tweet.date) : '';
  return `<header class="tweet-head">
    ${avatar}
    <div class="author">
      <div class="name">${escapeHtml(tweet.author.name)}${verified}</div>
      <div class="handle">@${escapeHtml(tweet.author.handle)}${date ? ` · ${escapeHtml(date)}` : ''}</div>
    </div>
  </header>`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderEngagement(e: NonNullable<TweetNode['engagement']>): string {
  const parts: string[] = [];
  if (e.replies !== undefined) parts.push(`💬 ${formatCount(e.replies)}`);
  if (e.reposts !== undefined) parts.push(`🔁 ${formatCount(e.reposts)}`);
  if (e.likes !== undefined) parts.push(`❤️ ${formatCount(e.likes)}`);
  if (e.bookmarks !== undefined) parts.push(`🔖 ${formatCount(e.bookmarks)}`);
  if (e.views !== undefined) parts.push(`👁 ${formatCount(e.views)}`);
  return parts.length > 0 ? `<footer class="engagement">${parts.map(escapeHtml).join(' · ')}</footer>` : '';
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000 < 10 ? (n / 1000).toFixed(1) : Math.round(n / 1000)) + 'K';
  return (n / 1_000_000 < 10 ? (n / 1_000_000).toFixed(1) : Math.round(n / 1_000_000)) + 'M';
}

function renderSource(meta: DocumentMetadata): string {
  return `<div class="source-footer"><a href="${escapeAttr(meta.sourceUrl)}">${escapeHtml(meta.sourceUrl)}</a></div>`;
}

// ─── Media / poll / link card ───────────────────────────────────────

function renderMedia(m: MediaItem): string {
  const url = m.kind === 'video' || m.kind === 'gif' ? (m.posterUrl || m.url) : m.url;
  const overlay = (m.kind === 'video' || m.kind === 'gif')
    ? '<div class="media-overlay">▶</div>'
    : '';
  return `<div class="media-tile">
    <img src="${escapeAttr(url)}" alt="${escapeAttr(m.alt || '')}" loading="lazy">
    ${overlay}
  </div>`;
}

function renderPoll(poll: PollNode): string {
  const choices = poll.choices.map((c) => {
    const pct = c.percent !== undefined ? `<span class="poll-pct">${c.percent}%</span>` : '';
    const fill = c.percent !== undefined ? `<div class="poll-bar"><div class="poll-bar-fill" style="width:${c.percent}%"></div></div>` : '';
    return `<div class="poll-choice">${fill}<span class="poll-label">${escapeHtml(c.label)}</span>${pct}</div>`;
  }).join('');
  const footer = poll.footer ? `<div class="poll-footer">${escapeHtml(poll.footer)}</div>` : '';
  return `<div class="poll">${choices}${footer}</div>`;
}

function renderLinkCard(card: LinkCardNode): string {
  const img = card.imageUrl
    ? `<div class="link-card-image"><img src="${escapeAttr(card.imageUrl)}" alt=""></div>`
    : '';
  const desc = card.description ? `<div class="link-card-desc">${escapeHtml(card.description)}</div>` : '';
  const domain = card.domain ? `<div class="link-card-domain">${escapeHtml(card.domain)}</div>` : '';
  return `<a class="link-card" href="${escapeAttr(card.url)}">
    ${img}
    <div class="link-card-body">
      ${domain}
      <div class="link-card-title">${escapeHtml(card.title)}</div>
      ${desc}
    </div>
  </a>`;
}

// X Article card. Same skeleton as LinkCard but with a "📝 Article" eyebrow
// and no domain (it's X-hosted). When url is absent (the common case for
// article-quote tweets), we render a non-link <div> with the same class so
// styling stays uniform.
function renderArticleCard(card: ArticleCardNode): string {
  const img = card.imageUrl
    ? `<div class="link-card-image"><img src="${escapeAttr(card.imageUrl)}" alt=""></div>`
    : '';
  const desc = card.description ? `<div class="link-card-desc">${escapeHtml(card.description)}</div>` : '';
  const inner = `${img}
    <div class="link-card-body">
      <div class="link-card-domain">📝 Article</div>
      <div class="link-card-title">${escapeHtml(card.title)}</div>
      ${desc}
    </div>`;
  return card.url
    ? `<a class="link-card article-card" href="${escapeAttr(card.url)}">${inner}</a>`
    : `<div class="link-card article-card">${inner}</div>`;
}

// ─── Article ────────────────────────────────────────────────────────

function renderArticle(article: ArticleNode, meta: DocumentMetadata, opts: RenderPdfHtmlOptions = {}): string {
  const title = meta.title ? `<h1 class="article-title">${escapeHtml(meta.title)}</h1>` : '';
  const byline = `<p class="article-byline">By ${escapeHtml(meta.author.name)} <span class="handle">@${escapeHtml(meta.author.handle)}</span></p>`;
  const banner = article.banner
    ? `<img class="article-banner" src="${escapeAttr(article.banner.url)}" alt="">`
    : '';
  const engagement = opts.includeEngagement && meta.engagement
    ? renderEngagement(meta.engagement)
    : '';
  const body = article.children.map(renderArticleBlock).join('\n');
  return `<article class="article">${title}${byline}${banner}${engagement}<div class="article-body">${body}</div>${renderSource(meta)}</article>`;
}

function renderArticleBlock(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${renderInlines(block.children)}</p>`;
    case 'heading':
      return `<h${block.depth}>${renderInlines(block.children)}</h${block.depth}>`;
    case 'list':
      return renderList(block);
    case 'listItem':
      return `<li>${block.children.map(renderArticleBlock).join('')}</li>`;
    case 'code':
      return `<pre><code${block.lang ? ` class="lang-${escapeAttr(block.lang)}"` : ''}>${escapeHtml(block.value)}</code></pre>`;
    case 'blockquote':
      return `<blockquote>${block.children.map(renderArticleBlock).join('')}</blockquote>`;
    case 'image':
      return `<figure class="article-image"><img src="${escapeAttr(block.url)}" alt="${escapeAttr(block.alt || '')}">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`;
    case 'video':
      return `<figure class="article-image"><img src="${escapeAttr(block.posterUrl)}" alt="${escapeAttr(block.alt || '')}"></figure>`;
    case 'thematicBreak':
      return '<hr>';
    case 'articleCard':
      return renderArticleCard(block);
    default:
      return '';
  }
}

function renderList(list: { ordered: boolean; children: { type: 'listItem'; children: Block[] }[] }): string {
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.children.map((item) =>
    `<li>${item.children.map(renderArticleBlock).join('')}</li>`
  ).join('');
  return `<${tag}>${items}</${tag}>`;
}

// ─── Inlines ────────────────────────────────────────────────────────

function renderInlines(nodes: InlineNode[]): string {
  return nodes.map(renderInline).join('');
}

function renderInline(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'break':
      return '<br>';
    case 'entity': {
      const sigil = node.kind === 'mention' ? '@' : node.kind === 'hashtag' ? '#' : '$';
      return `<a class="entity entity-${node.kind}" href="${escapeAttr(node.url)}">${sigil}${escapeHtml(node.value)}</a>`;
    }
    case 'link':
      return `<a href="${escapeAttr(node.url)}">${renderInlines(node.children)}</a>`;
    case 'strong':
      return `<strong>${renderInlines(node.children)}</strong>`;
    case 'emphasis':
      return `<em>${renderInlines(node.children)}</em>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// ─── Styles ─────────────────────────────────────────────────────────

const STYLES = `
.xclipper-root,.xclipper-root *{box-sizing:border-box}
.xclipper-root{max-width:600px;margin:0 auto;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#0f1419;background:#fff;-webkit-font-smoothing:antialiased;line-height:1.4}
.tweet-card{border:1px solid #eff3f4;border-radius:16px;padding:16px;margin-bottom:16px;background:#fff;line-height:1.4}
.tweet-card.is-quote{border-color:#cfd9de;background:#f7f9f9;margin-top:12px;margin-bottom:0}
.tweet-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.avatar{width:48px;height:48px;border-radius:50%;flex:0 0 48px;object-fit:cover;background:#1d9bf0;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px}
.avatar-placeholder{font-family:inherit}
.author .name{font-weight:700;font-size:15px;color:#0f1419;line-height:1.2}
.author .handle{color:#536471;font-size:14px;line-height:1.3}
.verified{color:#1d9bf0;margin-left:4px}
.tweet-body{font-size:17px;line-height:1.4;color:#0f1419;white-space:pre-wrap;word-wrap:break-word}
.tweet-body a{color:#1d9bf0;text-decoration:none}
.tweet-body a:hover{text-decoration:underline}
.entity{color:#1d9bf0;text-decoration:none}
.tweet-media{display:grid;grid-template-columns:1fr;gap:2px;margin-top:12px;border-radius:16px;overflow:hidden;border:1px solid #eff3f4}
.media-tile{position:relative}
.media-tile img{display:block;width:100%;height:auto}
.media-overlay{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;border-radius:50%;background:rgba(15,20,25,0.78);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;pointer-events:none}
.poll{margin-top:12px;border:1px solid #eff3f4;border-radius:8px;padding:8px 12px}
.poll-choice{position:relative;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;font-size:14px}
.poll-bar{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:4px;overflow:hidden;background:transparent}
.poll-bar-fill{height:100%;background:#cfe8fa}
.poll-label,.poll-pct{position:relative;z-index:1}
.poll-pct{font-weight:700;color:#0f1419}
.poll-footer{font-size:13px;color:#536471;margin-top:6px;font-style:italic}
.link-card{display:block;margin-top:12px;border:1px solid #eff3f4;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;background:#fff}
.link-card-image img{display:block;width:100%;max-height:300px;object-fit:cover}
.link-card-body{padding:12px}
.link-card-domain{font-size:13px;color:#536471}
.link-card-title{font-weight:700;font-size:15px;margin-top:2px;color:#0f1419}
.link-card-desc{font-size:14px;color:#536471;margin-top:4px}
.engagement{margin-top:12px;padding-top:8px;border-top:1px solid #eff3f4;font-size:13px;color:#536471}
.article .engagement{margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #eff3f4}
.source-footer{margin-top:8px;padding-top:8px;font-size:12px;color:#536471}
.source-footer a{color:#536471;text-decoration:none}
.thread .tweet-card{margin-bottom:0;border-radius:16px 16px 0 0}
.thread .tweet-card + .tweet-card{margin-top:-1px;border-top:1px dashed #cfd9de;border-radius:0}
.thread .tweet-card:last-of-type{border-radius:0 0 16px 16px}
.thread .tweet-card:only-of-type{border-radius:16px}
.article{padding:8px 0}
.article-title{font-size:30px;line-height:1.2;margin:0 0 8px;font-weight:800;color:#0f1419}
.article-byline{font-size:14px;color:#536471;margin:0 0 16px}
.article-byline .handle{color:#1d9bf0}
.article-banner{display:block;width:100%;border-radius:12px;margin-bottom:20px}
.article-body{font-size:17px;line-height:1.6;color:#0f1419}
.article-body p{margin:0 0 16px}
.article-body h1{font-size:24px;font-weight:800;margin:28px 0 12px}
.article-body h2{font-size:20px;font-weight:700;margin:24px 0 12px}
.article-body h3{font-size:18px;font-weight:700;margin:20px 0 10px}
.article-body a{color:#1d9bf0;text-decoration:none}
.article-body ul,.article-body ol{margin:0 0 16px;padding-left:24px}
.article-body li{margin:0 0 6px}
.article-body code{background:#f7f9f9;padding:1px 4px;border-radius:3px;font-family:"SFMono-Regular",Menlo,Consolas,monospace;font-size:14px}
.article-body pre{background:#0f1419;color:#eff3f4;padding:14px 16px;border-radius:8px;overflow-x:auto;margin:0 0 16px;font-size:13px;line-height:1.5}
.article-body pre code{background:transparent;color:inherit;padding:0;font-size:13px}
.article-body blockquote{border-left:3px solid #cfd9de;margin:0 0 16px;padding:0 0 0 16px;color:#536471}
.article-body figure{margin:0 0 16px}
.article-body figure img{display:block;width:100%;border-radius:8px}
.article-body figcaption{font-size:13px;color:#536471;text-align:center;margin-top:6px}
.article-body hr{border:none;border-top:1px solid #eff3f4;margin:24px 0}
.xclipper-root strong{font-weight:700}
.xclipper-root em{font-style:italic}
.xclipper-root img{max-width:100%;height:auto}
.xclipper-root .media-tile img{height:auto}
.xclipper-root .link-card-image img{max-height:240px}
.xclipper-root .article-banner{max-height:300px;object-fit:cover}
.xclipper-root .tweet-card,.xclipper-root .link-card,.xclipper-root .article-image{page-break-inside:avoid}
`;
