import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { domToAst } from '../src/content/dom-to-ast';
import { renderMarkdown, renderMarkdownBody } from '../src/ast/render-markdown';
import { postProcess } from '../src/shared/post-process';
import type { ExtractedContent, TweetMetadata } from '../src/types/messages';
import type { Document, InlineNode } from '../src/ast/types';

// Phase 3 parity test: AST extractor → AST → renderMarkdown → postProcess,
// compared against the existing .md fixture. Diffs here are either renderer
// bugs to fix or justified improvements (call them out in PR review).

const FIXTURES = resolve(__dirname, 'fixtures');

// Fixtures whose AST-rendered markdown reaches semantic parity with the
// existing Turndown output. Grow this list as the renderer matures.
const RENDER_READY_FIXTURES = [
  'elonmusk-2052914500169613445',
  'Huawei-2059206000587210807',
  'iret77-2058898207304733029',
  'bcherny-2053982327123132846',
  'MarioNawfal-2053855649398915580',
  'marcelpociot-2038915006050300007',
  'theonejvo-2015892980851474595',
  'GoogleDeepMind-2039735446628925907',
];

const VOLATILE_FIELDS = ['likes', 'reposts', 'replies', 'bookmarks', 'views', 'date'];

function normalize(md: string): string {
  let out = md;
  for (const f of VOLATILE_FIELDS) {
    out = out.replace(new RegExp(`^${f}:.*$`, 'm'), `${f}: <ignored>`);
  }
  return out.replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');
}

function normalizeWhitespace(root: Element, win: { Node: typeof Node }): void {
  const NF = (win as unknown as { NodeFilter: typeof globalThis.NodeFilter }).NodeFilter
    || globalThis.NodeFilter;
  const walker = (root.ownerDocument as unknown as Document).createTreeWalker(root, NF.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null = walker.nextNode();
  while (n) { textNodes.push(n as Text); n = walker.nextNode(); }
  for (const t of textNodes) {
    let p: Node | null = t.parentNode;
    let inPre = false;
    while (p) {
      if (p.nodeType === 1) {
        const tag = (p as Element).tagName;
        if (tag === 'PRE' || tag === 'CODE') { inPre = true; break; }
      }
      p = p.parentNode;
    }
    if (inPre) continue;
    const v = t.nodeValue || '';
    let next = v.replace(/\n[ \t]{2,}/g, ' ').replace(/[ \t]{2,}/g, ' ');
    if (next !== v) t.nodeValue = next;
  }
}

function loadFixtureHtml(htmlPath: string, url: string): void {
  const html = readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html, { url });
  normalizeWhitespace(dom.window.document.documentElement, dom.window);
  document.documentElement.replaceWith(
    dom.window.document.documentElement.cloneNode(true) as HTMLElement
  );
  const path = new URL(url).pathname;
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: path, href: url },
    writable: true,
    configurable: true,
  });
}

function sourceUrlFromMd(mdPath: string): string {
  const md = readFileSync(mdPath, 'utf-8');
  return md.match(/^source:\s*"(.+)"$/m)?.[1] || '';
}

function astToExtractedContent(doc: ReturnType<typeof domToAst>): ExtractedContent {
  const meta = doc.metadata;
  const tm: TweetMetadata | undefined = meta.engagement && { ...meta.engagement };
  return {
    type: meta.type,
    author: { name: meta.author.name, handle: `@${meta.author.handle}` },
    title: meta.title,
    markdown: renderMarkdown(doc),
    sourceUrl: meta.sourceUrl,
    date: meta.date,
    tweetId: meta.tweetId,
    metadata: tm,
  };
}

describe('AST renderMarkdown parity', () => {
  for (const name of RENDER_READY_FIXTURES) {
    it(name, () => {
      const htmlPath = join(FIXTURES, `${name}.html`);
      const mdPath = join(FIXTURES, `${name}.md`);
      if (!existsSync(htmlPath)) {
        console.warn(`\n  ⚠️  skipping "${name}" — html fixture missing.\n`);
        return;
      }
      const url = sourceUrlFromMd(mdPath);
      loadFixtureHtml(htmlPath, url);

      const ast = domToAst();
      const data = astToExtractedContent(ast);
      const processed = postProcess(data, { includeMetadata: true, downloadImages: false });

      const expected = readFileSync(mdPath, 'utf-8');
      expect(normalize(processed.markdown)).toBe(normalize(expected));
    });
  }
});

// Authors on X often style the trailing space of a run, so the AST carries
// whitespace inside strong/emphasis. Markdown can't: `**bold **` isn't bold.
describe('emphasis edge whitespace', () => {
  const author = { name: 'A', handle: 'a' };
  const tweetDoc = (text: InlineNode[]): Document => ({
    version: 1,
    metadata: {
      type: 'tweet',
      sourceUrl: 'https://x.com/a/status/1',
      tweetId: '1',
      author,
      date: '2026-01-01T00:00:00.000Z',
    },
    body: { type: 'tweet', author, date: '2026-01-01T00:00:00.000Z', tweetId: '1', text, media: [] },
  });
  const render = (text: InlineNode[]): string => renderMarkdownBody(tweetDoc(text));

  it('hoists a trailing space out of strong', () => {
    expect(render([
      { type: 'strong', children: [{ type: 'text', value: 'Best used for: ' }] },
      { type: 'text', value: 'Shorter tasks.' },
    ])).toBe('**Best used for:** Shorter tasks.');
  });

  it('hoists a trailing space out of emphasis', () => {
    expect(render([
      { type: 'emphasis', children: [{ type: 'text', value: 'written by ' }] },
      { type: 'text', value: 'someone' },
    ])).toBe('*written by* someone');
  });

  it('hoists a leading space', () => {
    expect(render([
      { type: 'text', value: 'and' },
      { type: 'strong', children: [{ type: 'text', value: ' dynamic workflows' }] },
    ])).toBe('and **dynamic workflows**');
  });

  it('drops the markers when the run is only whitespace', () => {
    expect(render([
      { type: 'text', value: 'a' },
      { type: 'strong', children: [{ type: 'text', value: ' ' }] },
      { type: 'text', value: 'b' },
    ])).toBe('a b');
  });

  it('drops the markers when the run is only zero-width characters', () => {
    expect(render([
      { type: 'text', value: 'turns.' },
      { type: 'strong', children: [{ type: 'text', value: '\u200d' }] },
    ])).toBe('turns.\u200d');
  });

  it('keeps a run that has a zero-width character alongside real text', () => {
    expect(render([
      { type: 'strong', children: [{ type: 'text', value: 'bold\u200d' }] },
    ])).toBe('**bold\u200d**');
  });

  it('leaves an already-tight run alone', () => {
    expect(render([
      { type: 'strong', children: [{ type: 'text', value: 'Triggered by' }] },
      { type: 'text', value: ': A user prompt.' },
    ])).toBe('**Triggered by**: A user prompt.');
  });
});
