// The one AST → ExtractedContent conversion, shared by every producer.
//
// Three paths build an ExtractedContent from a Document: the single-export
// tweet/thread path, the single-export article path, and the background (Fast
// Batch, zip mode, non-md per-item formats). They must agree byte-for-byte,
// because postProcess writes `author.handle` straight into frontmatter — so the
// `@` prefix the AST strips (dom-to-ast/shared.ts stripHandlePrefix, and
// GraphQL's `screen_name`) is re-added here, once, for all of them.

import type { ExtractedContent } from '../types/messages';
import type { Document } from '../ast/types';
import { renderMarkdown, type MarkdownRenderOptions } from '../ast/render-markdown';

export function docToExtracted(
  doc: Document,
  renderOptions: MarkdownRenderOptions = {},
): ExtractedContent {
  const meta = doc.metadata;
  return {
    type: meta.type,
    author: { name: meta.author.name, handle: `@${meta.author.handle}` },
    title: meta.title,
    markdown: renderMarkdown(doc, renderOptions),
    sourceUrl: meta.sourceUrl,
    date: meta.date,
    tweetId: meta.tweetId,
    ...(meta.engagement ? { metadata: meta.engagement } : {}),
    body: doc,
  };
}
