import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { extract } from '../src/content/content';

function loadFixture(name: string, url: string): void {
  const html = readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8');
  const dom = new JSDOM(html, { url });
  const src = dom.window.document.documentElement;

  // Replace the test environment's document with the parsed fixture's tree.
  document.documentElement.replaceWith(src.cloneNode(true) as HTMLElement);

  // Override location.pathname / href so isArticlePage() and extract() see
  // the /status/ URL.
  const path = new URL(url).pathname;
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: path, href: url },
    writable: true,
    configurable: true,
  });
}

describe('extract() — long-form article', () => {
  it('emits image markdown for the banner and every inline media link', async () => {
    loadFixture(
      'article-theonejvo.html',
      'https://x.com/theonejvo/status/2015401219746128322'
    );

    const res = await extract({ includeMetadata: false });
    expect(res.success).toBe(true);
    if (!res.success || !res.data) return;

    const md = res.data.markdown;

    expect(res.data.type).toBe('article');

    // The exact list of inline article images that must show up as
    // ![…](https://pbs.twimg.com/media/<id>…) when the body has fully loaded.
    // This is the regression we keep hitting: when extraction runs too early
    // the <a href=/.../media/…> wrappers exist but their inner <img> hasn't
    // hydrated, so the walker emits `[](url)` instead of `![Image](src)`.
    const expectedMedia = [
      'G_f76WFbAAAwrmo',
      'G_f8JXUbYAE_3vM',
      'G_f_S_EbAAAsMT_',
      'G_gA5KtbAAAI_nh',
      'G_gbrFZWIAAK203',
      'G_ggIP7asAAyjnA',
    ];
    for (const id of expectedMedia) {
      expect(md, `missing image ${id}`).toMatch(
        new RegExp(`!\\[[^\\]]*\\]\\(https:\\/\\/pbs\\.twimg\\.com\\/media\\/${id}`)
      );
    }

    // No empty-alt link wrappers leaking (`[](https://x.com/.../media/...)`)
    expect(md).not.toMatch(/\[\]\(https:\/\/x\.com\/[^)]+\/media\//);

    // A banner / hero image must be present (any pbs.twimg.com/media URL).
    expect(md).toMatch(/!\[Banner\]\(https:\/\/pbs\.twimg\.com\//);
  });
});
