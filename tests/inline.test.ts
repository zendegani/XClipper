import { describe, it, expect } from 'vitest';
import { extractInline } from '../src/content/dom-to-ast/inline';
import type { InlineNode } from '../src/ast/types';

// X labels a t.co link with aria-hidden spans whose visibility comes from CSS:
// the scheme and, for a link it shortens, the rest of the URL are hidden, and
// the closing "…" is shown. Markup mirrors a real capture, minus the classes.
function inline(html: string): InlineNode[] {
  const el = document.createElement('div');
  el.innerHTML = html;
  return extractInline(el, null);
}

describe('extractInline — t.co links', () => {
  it('builds a shortened link from the full URL and labels it as the page shows it (#158)', () => {
    const nodes = inline(
      'via <a href="https://t.co/abc"><span aria-hidden="true">https://</span>example.com/watch?v=abcdef' +
        '<span aria-hidden="true">ghijk</span><span aria-hidden="true">…</span></a> now'
    );
    expect(nodes).toEqual([
      { type: 'text', value: 'via ' },
      {
        type: 'link',
        url: 'https://example.com/watch?v=abcdefghijk',
        children: [{ type: 'text', value: 'example.com/watch?v=abcdef…' }],
      },
      { type: 'text', value: ' now' },
    ]);
  });

  it('labels a full-length link without its hidden scheme', () => {
    const nodes = inline('<a href="https://t.co/abc"><span aria-hidden="true">http://</span>example.com</a>');
    expect(nodes).toEqual([
      { type: 'link', url: 'http://example.com', children: [{ type: 'text', value: 'example.com' }] },
    ]);
  });
});
