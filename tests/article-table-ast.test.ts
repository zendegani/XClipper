import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { domToAst } from '../src/content/dom-to-ast';
import { renderMarkdown } from '../src/ast/render-markdown';
import { renderPdfHtml } from '../src/ast/render-pdf-html';

// X Article tables live in a non-editable <section> block, the same wrapper
// code blocks and separators use. Without a dedicated branch the extractor
// falls through to the paragraph fallback and concatenates every cell.

function loadArticle(bodyHtml: string): void {
  const url = 'https://x.com/theonejvo/status/2015401219746128322';
  const html = `
    <html>
      <body>
        <article role="article">
          <div data-testid="User-Name">
            <a href="/theonejvo"><span>Jamieson</span></a>
            <a href="/theonejvo"><span>@theonejvo</span></a>
          </div>
          <time datetime="2026-01-01T00:00:00.000Z"></time>
          <div data-testid="twitter-article-title">Tables</div>
          <div data-testid="twitterArticleRichTextView">
            <div data-testid="longformRichTextComponent">
              <div data-contents="true">${bodyHtml}</div>
            </div>
          </div>
        </article>
      </body>
    </html>
  `;
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

function firstBlock() {
  const ast = domToAst();
  if (ast.body.type !== 'article') throw new Error('expected an article');
  return { ast, block: ast.body.children[0] };
}

describe('domToAst() article tables', () => {
  it('extracts a header row and data rows', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><th><span>Loop</span></th><th><span>Reach for</span></th></tr>
          <tr><td><span>Turn-based</span></td><td><span>Skills</span></td></tr>
          <tr><td><span>Goal-based</span></td><td><span>/goal</span></td></tr>
        </table>
      </section>
    `);

    const { ast, block } = firstBlock();
    expect(block).toEqual({
      type: 'table',
      header: {
        type: 'tableRow',
        children: [
          { type: 'tableCell', children: [{ type: 'text', value: 'Loop' }] },
          { type: 'tableCell', children: [{ type: 'text', value: 'Reach for' }] },
        ],
      },
      children: [
        {
          type: 'tableRow',
          children: [
            { type: 'tableCell', children: [{ type: 'text', value: 'Turn-based' }] },
            { type: 'tableCell', children: [{ type: 'text', value: 'Skills' }] },
          ],
        },
        {
          type: 'tableRow',
          children: [
            { type: 'tableCell', children: [{ type: 'text', value: 'Goal-based' }] },
            { type: 'tableCell', children: [{ type: 'text', value: '/goal' }] },
          ],
        },
      ],
    });

    expect(renderMarkdown(ast)).toContain(
      '| Loop | Reach for |\n'
      + '| --- | --- |\n'
      + '| Turn-based | Skills |\n'
      + '| Goal-based | /goal |'
    );
  });

  it('keeps cell formatting and links', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><th><span>Command</span></th></tr>
          <tr><td><span style="font-weight: bold;">/goal</span><span> — see </span><a href="https://example.com/docs"><span>docs</span></a></td></tr>
        </table>
      </section>
    `);

    expect(renderMarkdown(firstBlock().ast)).toContain(
      '| **/goal** — see [docs](https://example.com/docs) |'
    );
  });

  it('emits an empty header when the table has no th row', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><td><span>a</span></td><td><span>b</span></td></tr>
        </table>
      </section>
    `);

    const { ast, block } = firstBlock();
    expect(block).toMatchObject({ type: 'table', children: [{ type: 'tableRow' }] });
    expect(block).not.toHaveProperty('header');
    expect(renderMarkdown(ast)).toContain('|  |  |\n| --- | --- |\n| a | b |');
  });

  it('escapes pipes and flattens hard breaks inside a cell', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><th><span>Syntax</span></th></tr>
          <tr><td><span>a | b</span><br><span>next line</span></td></tr>
        </table>
      </section>
    `);

    const md = renderMarkdown(firstBlock().ast);
    expect(md).toContain('| a \\| b next line |');
    expect(md).not.toContain('a | b |');
  });

  // Escaping the pipe alone would turn the author's `\` + `|` into `\\|`,
  // which reads as an escaped backslash plus a live pipe — the row splits.
  it('escapes a backslash before escaping the pipe', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><th><span>Syntax</span></th></tr>
          <tr><td><span>C:\\ | next</span></td></tr>
        </table>
      </section>
    `);

    const cellLine = renderMarkdown(firstBlock().ast)
      .split('\n')
      .find((l) => l.includes('C:'))!;
    expect(cellLine).toBe('| C:\\\\ \\| next |');
    // One cell, not two: the escaped pipe must not close it early.
    expect(cellLine.split(/(?<!\\)\|/).filter((s) => s.trim()).length).toBe(1);
  });

  it('pads short rows so the column count stays stable', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><th><span>a</span></th><th><span>b</span></th><th><span>c</span></th></tr>
          <tr><td><span>1</span></td></tr>
        </table>
      </section>
    `);

    expect(renderMarkdown(firstBlock().ast)).toContain('| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |');
  });

  it('renders a real table element for PDF', () => {
    loadArticle(`
      <section data-block="true" contenteditable="false">
        <table>
          <tr><th><span>Loop</span></th></tr>
          <tr><td><span>Turn-based</span></td></tr>
        </table>
      </section>
    `);

    const html = renderPdfHtml(firstBlock().ast);
    expect(html).toContain('<table><thead><tr><th>Loop</th></tr></thead><tbody><tr><td>Turn-based</td></tr></tbody></table>');
  });
});
