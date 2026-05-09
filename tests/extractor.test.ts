import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { extract } from '../src/content/content';
import { postProcess } from '../src/shared/post-process';

// ─── Fixture pairing ────────────────────────────────────────────────
//
// Each .md file in tests/fixtures/ is treated as the expected output for the
// status id parsed from its `source:` frontmatter. We look for an .html file
// in the same folder whose name contains that id; that html is the input.
// Tests skip (warn) when the html is missing — html fixtures are gitignored
// and developers are expected to drop them in locally.
//
// Volatile frontmatter fields (likes, reposts, replies, bookmarks, views,
// date) are normalized to "<ignored>" before comparison since they shift
// over time even when the post itself hasn't changed.

const FIXTURES = resolve(__dirname, 'fixtures');
const VOLATILE_FIELDS = ['likes', 'reposts', 'replies', 'bookmarks', 'views', 'date'];

function normalizeWhitespace(root: Element, win: { Node: typeof Node }): void {
  const NodeFilter = (win as unknown as { NodeFilter: typeof globalThis.NodeFilter }).NodeFilter
    || globalThis.NodeFilter;
  const walker = (root.ownerDocument as unknown as Document).createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT
  );
  const textNodes: Text[] = [];
  let n: Node | null = walker.nextNode();
  while (n) {
    textNodes.push(n as Text);
    n = walker.nextNode();
  }
  for (const t of textNodes) {
    // Skip text inside <pre> / code blocks — preserve their formatting.
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
    // Replace `\n + indentation` (prettifier output) with a single space,
    // but keep standalone `\n` alone — X.com encodes tweet line breaks as
    // literal `\n` in text nodes, and the extractor relies on them.
    let next = v.replace(/\n[ \t]{2,}/g, ' ');
    // Also collapse runs of 2+ spaces/tabs (no newline) into one space.
    next = next.replace(/[ \t]{2,}/g, ' ');
    if (next !== v) t.nodeValue = next;
  }
}

function loadFixtureHtml(htmlPath: string, url: string): void {
  const html = readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html, { url });
  // DevTools' "Copy outerHTML" pretty-prints, inserting newlines +
  // indentation both between elements AND inside text content. Production
  // DOM has none of that. We strip it to mirror real conditions before
  // running the extractor — but keep <pre> / code-block content intact.
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

function normalize(md: string): string {
  let out = md;
  for (const f of VOLATILE_FIELDS) {
    out = out.replace(new RegExp(`^${f}:.*$`, 'm'), `${f}: <ignored>`);
  }
  // Trailing whitespace shouldn't break a comparison.
  return out.replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');
}

function parseSourceUrl(md: string): string | null {
  return md.match(/^source:\s*"(.+)"$/m)?.[1] || null;
}

function findHtmlForId(id: string): string | null {
  for (const f of readdirSync(FIXTURES)) {
    if (f.endsWith('.html') && f.includes(id)) return join(FIXTURES, f);
  }
  return null;
}

const mdFixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.md'));

describe('extract() snapshot tests', () => {
  for (const mdName of mdFixtures) {
    const mdPath = join(FIXTURES, mdName);
    const expectedRaw = readFileSync(mdPath, 'utf-8');
    const url = parseSourceUrl(expectedRaw);
    const id = url?.match(/\/status\/(\d+)/)?.[1] || '';
    const htmlPath = id ? findHtmlForId(id) : null;

    it(`${mdName}`, async () => {
      if (!url) {
        throw new Error(`fixture ${mdName} has no \`source:\` frontmatter`);
      }
      if (!htmlPath || !existsSync(htmlPath)) {
        console.warn(
          `\n  ⚠️  skipping "${mdName}" — no .html fixture found containing id ${id}.\n  ` +
            `Drop the page's outerHTML into tests/fixtures/<anything>${id}.html and re-run.\n`
        );
        return;
      }

      loadFixtureHtml(htmlPath, url);

      const res = await extract({ includeMetadata: true });
      expect(res.success, res.success ? '' : (res as { error?: string }).error || '').toBe(true);
      if (!res.success || !res.data) return;

      const processed = postProcess(res.data, {
        includeMetadata: true,
        downloadImages: false,
      });

      expect(normalize(processed.markdown)).toBe(normalize(expectedRaw));
    });
  }
});
