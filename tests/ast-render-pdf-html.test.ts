import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { renderPdfHtml } from '../src/ast/render-pdf-html';
import type { Document } from '../src/ast/types';

// Smoke test: verifies the PDF HTML renderer produces well-formed output
// covering tweets, threads, polls, link cards, and articles. We do not run
// html2pdf in jsdom (it requires real layout) — that's a manual browser
// smoke. Here we only assert the HTML structure is sane.

const FIXTURES = resolve(__dirname, 'fixtures');

const FIXTURES_TO_RENDER = [
  'elonmusk-2052914500169613445',
  'bcherny-2053982327123132846',
  'MarioNawfal-2053855649398915580',
  'GoogleDeepMind-2039735446628925907',
  'iret77-2058898207304733029',
  'Huawei-2059206000587210807',
  'marcelpociot-2038915006050300007',
  'theonejvo-2015892980851474595',
];

function loadAst(name: string): Document {
  const raw = readFileSync(join(FIXTURES, `${name}.ast.json`), 'utf-8');
  // Strip our snapshot's '<ignored>' sentinels so the renderer sees plausible
  // values for date/engagement (renderer skips engagement if not an object).
  const cleaned = raw.replace(/"<ignored>"/g, 'null');
  const obj = JSON.parse(cleaned);
  // Date null breaks formatDate; replace with a stable ISO so the renderer
  // produces a stable header.
  walkTweets(obj.body, (t) => { if (t.date === null) t.date = '2026-01-01T00:00:00.000Z'; });
  if (obj.metadata.date === null) obj.metadata.date = '2026-01-01T00:00:00.000Z';
  if (obj.metadata.engagement === null) delete obj.metadata.engagement;
  return obj as Document;
}

function walkTweets(node: unknown, fn: (t: { date: string | null; engagement?: unknown; quotedTweet?: unknown; type: string }) => void): void {
  if (!node || typeof node !== 'object') return;
  const o = node as { type: string; date?: string | null; engagement?: unknown; quotedTweet?: unknown; tweets?: unknown[] };
  if (o.type === 'tweet') {
    fn(o as { date: string | null; engagement?: unknown; quotedTweet?: unknown; type: string });
    if (o.engagement === null) delete o.engagement;
    if (o.quotedTweet) walkTweets(o.quotedTweet, fn);
  }
  if (Array.isArray(o.tweets)) for (const t of o.tweets) walkTweets(t, fn);
}

describe('renderPdfHtml', () => {
  for (const name of FIXTURES_TO_RENDER) {
    it(`${name} produces well-formed HTML`, () => {
      const doc = loadAst(name);
      const html = renderPdfHtml(doc);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<title>');
      expect(html).toContain('<style>');
      expect(html).toContain('class="xclipper-root"');
      expect(html).toContain('</html>');
    });
  }

  it('emits a tweet card for single-tweet documents', () => {
    const doc = loadAst('bcherny-2053982327123132846');
    const html = renderPdfHtml(doc);
    expect(html).toContain('tweet-card');
    expect(html).toContain('is-quote');
    expect(html).toContain('@bcherny');
    expect(html).toContain('@claudeai');
  });

  it('emits a thread container for threads', () => {
    const doc = loadAst('GoogleDeepMind-2039735446628925907');
    const html = renderPdfHtml(doc);
    expect(html).toContain('class="thread"');
    expect(html).toContain('entity-mention');
  });

  it('emits article structure with banner and headings', () => {
    const doc = loadAst('theonejvo-2015892980851474595');
    const html = renderPdfHtml(doc);
    expect(html).toContain('class="article"');
    expect(html).toContain('article-title');
    expect(html).toContain('article-banner');
    expect(html).toContain('<h2>');
    expect(html).toContain('<pre><code');
  });

  it('emits a poll with bars and percentages', () => {
    const doc = loadAst('iret77-2058898207304733029');
    const html = renderPdfHtml(doc);
    expect(html).toContain('class="poll"');
    expect(html).toContain('poll-bar-fill');
    expect(html).toContain('20.9%');
  });

  it('emits a link card', () => {
    const doc = loadAst('marcelpociot-2038915006050300007');
    const html = renderPdfHtml(doc);
    expect(html).toContain('class="link-card"');
    expect(html).toContain('getpolyscope.com');
  });
});
