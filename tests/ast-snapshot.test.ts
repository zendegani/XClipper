import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { domToAst } from '../src/content/dom-to-ast';
import type { Document } from '../src/ast/types';

// AST snapshot suite. Each fixture lands an explicit `<name>.ast.json` next
// to the `.html` / `.md` pair. `toMatchFileSnapshot` auto-generates on first
// run; updates go through PR review (the snapshot file is part of the diff).
//
// Volatile fields (date, engagement counts) are normalized to '<ignored>'
// before comparison since they drift between captures without the body
// content changing.

const FIXTURES = resolve(__dirname, 'fixtures');

// Registry of fixtures whose AST extraction is wired up. Add entries as
// each fixture comes online; simpler fixtures land first.
const AST_READY_FIXTURES = [
  'elonmusk-2052914500169613445',
  'bcherny-2053982327123132846',
  'MarioNawfal-2053855649398915580',
  'GoogleDeepMind-2039735446628925907',
  'iret77-2058898207304733029',
  'Huawei-2059206000587210807',
];

function normalize(doc: Document): unknown {
  const clone = JSON.parse(JSON.stringify(doc));
  clone.metadata.date = '<ignored>';
  if (clone.metadata.engagement) clone.metadata.engagement = '<ignored>';
  ignoreVolatileInTree(clone.body);
  return clone;
}

function ignoreVolatileInTree(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'tweet') {
    obj.date = '<ignored>';
    if (obj.engagement) obj.engagement = '<ignored>';
    if (obj.quotedTweet) ignoreVolatileInTree(obj.quotedTweet);
  }
  if (Array.isArray(obj.tweets)) {
    for (const t of obj.tweets) ignoreVolatileInTree(t);
  }
}

function normalizeWhitespace(root: Element, win: { Node: typeof Node }): void {
  const NF = (win as unknown as { NodeFilter: typeof globalThis.NodeFilter }).NodeFilter
    || globalThis.NodeFilter;
  const walker = (root.ownerDocument as unknown as Document).createTreeWalker(
    root,
    NF.SHOW_TEXT
  );
  const textNodes: Text[] = [];
  let n: Node | null = walker.nextNode();
  while (n) {
    textNodes.push(n as Text);
    n = walker.nextNode();
  }
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
    let next = v.replace(/\n[ \t]{2,}/g, ' ');
    next = next.replace(/[ \t]{2,}/g, ' ');
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

describe('domToAst() snapshot tests', () => {
  for (const name of AST_READY_FIXTURES) {
    it(name, async () => {
      const htmlPath = join(FIXTURES, `${name}.html`);
      const mdPath = join(FIXTURES, `${name}.md`);
      const astPath = join(FIXTURES, `${name}.ast.json`);

      if (!existsSync(htmlPath)) {
        console.warn(`\n  ⚠️  skipping "${name}" — html fixture missing.\n`);
        return;
      }
      const url = sourceUrlFromMd(mdPath);
      if (!url) throw new Error(`fixture ${name} missing source URL in .md`);

      loadFixtureHtml(htmlPath, url);

      const ast = domToAst();
      const json = JSON.stringify(normalize(ast), null, 2) + '\n';
      await expect(json).toMatchFileSnapshot(astPath);
    });
  }
});
