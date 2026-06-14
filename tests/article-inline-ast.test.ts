import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { domToAst } from '../src/content/dom-to-ast';
import { renderMarkdown } from '../src/ast/render-markdown';

function loadArticle(html: string): void {
  const url = 'https://x.com/theonejvo/status/2015401219746128322';
  const dom = new JSDOM(html, { url });
  document.documentElement.replaceWith(
    dom.window.document.documentElement.cloneNode(true) as HTMLElement
  );
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: new URL(url).pathname, href: url },
    writable: true,
    configurable: true,
  });
}

describe('domToAst() article inline styling', () => {
  // X article inline code is rendered with BOTH font-weight:bold AND
  // font-style:italic on one span. The walker must keep both (strong > emphasis)
  // rather than dropping italic — see the GraphQL mapper, which already does.
  it('keeps italic when a span is both bold and italic', () => {
    loadArticle(`
      <html>
        <body>
          <article role="article">
            <div data-testid="User-Name">
              <a href="/theonejvo"><span>Jamieson</span></a>
              <a href="/theonejvo"><span>@theonejvo</span></a>
            </div>
            <time datetime="2026-01-01T00:00:00.000Z"></time>
            <div data-testid="twitter-article-title">Styles</div>
            <div data-testid="twitterArticleRichTextView">
              <div data-testid="longformRichTextComponent">
                <div data-contents="true">
                  <div><span>Run </span><span style="font-weight: bold; font-style: italic;">sudo</span><span> now</span></div>
                </div>
              </div>
            </div>
          </article>
        </body>
      </html>
    `);

    const ast = domToAst();
    expect(ast.body.type).toBe('article');
    if (ast.body.type !== 'article') return;
    expect(ast.body.children[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Run ' },
        { type: 'strong', children: [{ type: 'emphasis', children: [{ type: 'text', value: 'sudo' }] }] },
        { type: 'text', value: ' now' },
      ],
    });
    expect(renderMarkdown(ast)).toContain('Run ***sudo*** now');
  });
});
