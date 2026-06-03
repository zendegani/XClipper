import type { ExtractedContent } from '../types/messages';
import { domToAst } from './dom-to-ast';
import { renderMarkdown } from '../ast/render-markdown';

export function extractArticle(): ExtractedContent {
  const doc = domToAst();
  const meta = doc.metadata;
  return {
    type: meta.type,
    author: { name: meta.author.name, handle: `@${meta.author.handle}` },
    title: meta.title,
    markdown: renderMarkdown(doc),
    sourceUrl: meta.sourceUrl,
    date: meta.date,
    tweetId: meta.tweetId,
    ...(meta.engagement ? { metadata: meta.engagement } : {}),
    body: doc,
  };
}

