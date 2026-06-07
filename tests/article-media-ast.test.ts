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

describe('domToAst() article media blocks', () => {
  it('extracts captioned X article media links as images', () => {
    loadArticle(`
      <html>
        <body>
          <article role="article">
            <div data-testid="User-Name">
              <a href="/theonejvo"><span>Jamieson O'Reilly</span></a>
              <a href="/theonejvo"><span>@theonejvo</span></a>
            </div>
            <time datetime="2026-01-01T00:00:00.000Z"></time>
            <div data-testid="twitter-article-title">Captioned media</div>
            <div data-testid="twitterArticleRichTextView">
              <div data-testid="longformRichTextComponent">
                <div data-contents="true">
                  <section>
                    <a href="/theonejvo/article/2015401219746128322/media/2015356338050891776">
                      <img
                        src="https://pbs.twimg.com/media/G_f76WFbAAAwrmo?format=jpg&amp;name=medium"
                        alt="Image"
                      >
                    </a>
                    <div>Screenshot of shodan search identifying control servers</div>
                  </section>
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
      type: 'image',
      url: 'https://pbs.twimg.com/media/G_f76WFbAAAwrmo?format=jpg&name=large',
      alt: 'Image',
    });

    const markdown = renderMarkdown(ast);
    expect(markdown).toContain('![Image](https://pbs.twimg.com/media/G_f76WFbAAAwrmo?format=jpg&name=large)');
    expect(markdown).not.toContain('/article/2015401219746128322/media/');
  });
});
