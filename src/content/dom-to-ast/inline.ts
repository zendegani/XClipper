import type { InlineNode, EntityNode, LinkNode } from '../../ast/types';

export function extractArticleInline(el: Element): InlineNode[] {
  // Article inline reuses the tweet walker but accepts a wider set of <a>
  // hrefs (mentions can use /@handle) and emits <strong>/<em>.
  const out: InlineNode[] = [];
  for (const child of el.childNodes) {
    walkInline(child, null, out);
  }
  return collapseEdges(trimAroundBreaks(collapseSpaceRuns(mergeAdjacentText(out))));
}

// ─── Inline walker ──────────────────────────────────────────────────

export function extractInline(textEl: Element, quoteContainer: Element | null): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of textEl.childNodes) {
    walkInline(child, quoteContainer, out);
  }
  return collapseEdges(trimAroundBreaks(collapseSpaceRuns(mergeAdjacentText(out))));
}

function walkInline(node: Node, quoteContainer: Element | null, out: InlineNode[]): void {
  if (quoteContainer && node.nodeType === 1 && quoteContainer.contains(node as Element)) {
    return;
  }
  if (node.nodeType === 3) {
    const text = (node as Text).nodeValue || '';
    if (!text) return;
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) out.push({ type: 'break' });
      if (parts[i]) out.push({ type: 'text', value: parts[i] });
    }
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.tagName;
  if (tag === 'BR') {
    out.push({ type: 'break' });
    return;
  }
  if (tag === 'IMG') {
    // X renders emoji as <img alt="🎉">. v1 inlines the alt as text.
    const alt = el.getAttribute('alt');
    if (alt) out.push({ type: 'text', value: alt });
    return;
  }
  if (tag === 'A') {
    const inline = anchorToInline(el);
    if (inline) {
      out.push(inline);
      return;
    }
    // Unrecognised link shape — treat as transparent and walk children.
  }
  // Draft.js uses inline styles for bold/italic; tweets occasionally use <b>/<em>.
  // A single span can be BOTH (X article inline code is font-weight:bold +
  // font-style:italic) — nest emphasis inside strong so neither is dropped.
  const html = el as HTMLElement;
  const isStrong = tag === 'STRONG' || tag === 'B' || html.style?.fontWeight === 'bold';
  const isEm = tag === 'EM' || tag === 'I' || html.style?.fontStyle === 'italic';
  if (isStrong || isEm) {
    const children: InlineNode[] = [];
    for (const c of el.childNodes) walkInline(c, quoteContainer, children);
    let merged = mergeAdjacentText(children);
    if (merged.length > 0) {
      if (isEm) merged = [{ type: 'emphasis', children: merged }];
      if (isStrong) merged = [{ type: 'strong', children: merged }];
      out.push(...merged);
    }
    return;
  }
  for (const child of el.childNodes) {
    walkInline(child, quoteContainer, out);
  }
}

function anchorToInline(a: Element): EntityNode | LinkNode | null {
  const href = a.getAttribute('href') || '';
  const text = (a.textContent || '').trim();
  if (!href) return null;

  // Normalize x.com hrefs (absolute or relative) to their path component.
  const xPath = xComPath(href);

  // Mention: /handle or /@handle on x.com
  if (xPath) {
    const mention = xPath.match(/^\/@?([A-Za-z0-9_]+)$/);
    if (mention && text.startsWith('@')) {
      // Prefer the display text for the handle's case: X lowercases mention
      // hrefs in some renders (/huggingface) while the anchor text keeps the
      // case the author typed (@HuggingFace).
      const fromText = text.slice(1);
      const value = /^[A-Za-z0-9_]+$/.test(fromText) ? fromText : mention[1];
      return {
        type: 'entity',
        kind: 'mention',
        value,
        url: `https://x.com/${value}`,
      };
    }
    const hashtag = xPath.match(/^\/hashtag\/([^/?#]+)/);
    if (hashtag && text.startsWith('#')) {
      return {
        type: 'entity',
        kind: 'hashtag',
        value: decodeURIComponent(hashtag[1]),
        url: `https://x.com${xPath.split('?')[0]}`,
      };
    }
  }

  // Cashtag: text starts with $; href is /search?q=%24SYM or similar
  if (/^\$[A-Z]+$/.test(text)) {
    return {
      type: 'entity',
      kind: 'cashtag',
      value: text.slice(1),
      url: href.startsWith('/') ? `https://x.com${href}` : href,
    };
  }

  // External link
  const children: InlineNode[] = [];
  for (const child of a.childNodes) {
    walkInline(child, null, children);
  }
  return {
    type: 'link',
    url: resolveExternalUrl(href, text),
    children: mergeAdjacentText(children),
  };
}

function xComPath(href: string): string | null {
  if (href.startsWith('/')) return href;
  const m = href.match(/^https?:\/\/(?:www\.|m\.)?x\.com(\/.*)$/);
  return m ? m[1] : null;
}

// X wraps external links in t.co; the visible label is the display URL. When
// the display text looks like a URL, prefer it over the t.co wrapper. When
// it doesn't (or no recognisable form), keep the href as-is.
function resolveExternalUrl(href: string, text: string): string {
  // Protocol-relative → https.
  if (href.startsWith('//')) return `https:${href}`;
  const isTco = /^https?:\/\/t\.co\//.test(href);
  if (isTco) {
    if (/^https?:\/\//.test(text)) return text;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(text)) return `https://${text}`;
  }
  return href;
}

// X's live DOM sometimes splits a sentence into adjacent text nodes with a
// trailing + leading space ("the " + " question"); merging then yields a
// double space the author never typed. Blank runs are insignificant in
// rendered markdown, so collapse them. (Code blocks never pass through the
// inline walker, so indentation is unaffected.)
function collapseSpaceRuns(nodes: InlineNode[]): InlineNode[] {
  return nodes.map((n) =>
    n.type === 'text' ? { ...n, value: n.value.replace(/[ \t]{2,}/g, ' ') } : n
  );
}

function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev?.type === 'text') {
      out[out.length - 1] = { type: 'text', value: prev.value + n.value };
    } else {
      out.push(n);
    }
  }
  return out;
}

function trimAroundBreaks(nodes: InlineNode[]): InlineNode[] {
  const out = nodes.map<InlineNode>((n, i) => {
    if (n.type !== 'text') return n;
    let value = n.value;
    if (nodes[i + 1]?.type === 'break') value = value.replace(/[ \t]+$/, '');
    if (nodes[i - 1]?.type === 'break') value = value.replace(/^[ \t]+/, '');
    return { type: 'text', value };
  });
  return out.filter((n) => n.type !== 'text' || n.value !== '');
}

function collapseEdges(nodes: InlineNode[]): InlineNode[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start].type === 'break') start++;
  while (end > start && nodes[end - 1].type === 'break') end--;
  return nodes.slice(start, end);
}
