import TurndownService from 'turndown';

export const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

// Custom rule: resolve t.co links using visible text or title attribute
turndown.addRule('tcoLinks', {
  filter: (node) =>
    node.nodeName === 'A' &&
    !!(node as HTMLAnchorElement).getAttribute('href')?.includes('t.co'),
  replacement: (_content, node) => {
    const anchor = node as HTMLAnchorElement;
    const title = anchor.getAttribute('title');
    const visibleText = anchor.textContent?.trim() || '';

    const displayUrl = title && title.startsWith('http') ? title : visibleText;
    const targetUrl = title && title.startsWith('http') ? title : anchor.href;

    if (displayUrl.startsWith('http') || displayUrl.includes('.')) {
      return `[${displayUrl}](${targetUrl})`;
    }

    return `[${visibleText}](${targetUrl})`;
  },
});

turndown.addRule('xImages', {
  filter: 'img',
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const alt = img.getAttribute('alt') || 'Image';
    let src = img.getAttribute('src') || '';

    // Emoji and inline glyphs on X are served as .svg via <img>. Real media
    // images live on pbs.twimg.com and are never .svg. Hashflags are PNG.
    if (
      src.includes('twimg.com/emoji') ||
      src.includes('abs-0.twimg.com') ||
      /\.svg($|\?)/.test(src)
    ) {
      return alt;
    }

    if (src.includes('pbs.twimg.com') && !src.includes('format=')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }

    return src ? `![${alt}](${src})` : '';
  },
});

turndown.addRule('xVideos', {
  filter: 'video',
  replacement: (_content, node) => {
    const video = node as HTMLVideoElement;
    const poster = video.getAttribute('poster') || '';
    const src = video.querySelector('source')?.getAttribute('src') || '';
    const url = src || poster;
    return url ? `[🎥 Video](${url})` : '[🎥 Video]';
  },
});

// Move whitespace outside bold/italic delimiters so the output is valid markdown.
turndown.addRule('fixBoldWhitespace', {
  filter: (node) =>
    node.nodeName === 'STRONG' || node.nodeName === 'B' ||
    (node instanceof HTMLElement && node.style.fontWeight === 'bold'),
  replacement: (content) => {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return content;
    const leading = /^\s/.test(content) ? ' ' : '';
    const trailing = /\s$/.test(content) ? ' ' : '';
    return `${leading}**${trimmed}**${trailing}`;
  },
});

turndown.addRule('fixItalicWhitespace', {
  filter: (node) =>
    node.nodeName === 'EM' || node.nodeName === 'I' ||
    (node instanceof HTMLElement && node.style.fontStyle === 'italic'),
  replacement: (content) => {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return content;
    const leading = /^\s/.test(content) ? ' ' : '';
    const trailing = /\s$/.test(content) ? ' ' : '';
    return `${leading}*${trimmed}*${trailing}`;
  },
});

turndown.addRule('lineBreaks', {
  filter: 'br',
  replacement: () => '  \n',
});

turndown.addRule('atMentions', {
  filter: (node) => {
    if (node.nodeName !== 'A') return false;
    const href = (node as HTMLAnchorElement).getAttribute('href') || '';
    return /^\/[A-Za-z0-9_]+$/.test(href);
  },
  replacement: (_content, node) => {
    const anchor = node as HTMLAnchorElement;
    const text = anchor.textContent?.trim() || '';
    return text.startsWith('@') ? text : `@${text}`;
  },
});

export function cleanupMarkdown(md: string): string {
  let result = md.replace(/\n{2,}(@[A-Za-z0-9_]+)/g, ' $1');
  result = result.replace(/(@[A-Za-z0-9_]+)\n{2,}([.,;:!?])/g, '$1$2');
  result = result.replace(/(@[A-Za-z0-9_]+[.,;:!?]?)\n{2,}(@[A-Za-z0-9_]+)/g, '$1 $2');
  result = result.replace(/\n{2,}([.,;:!?])\s*\n/g, '$1\n');
  result = result.replace(/(@[A-Za-z0-9_]+)\n{2,}([.,;:!?])\s*$/gm, '$1$2');
  return result;
}
