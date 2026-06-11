import type { Document } from './types';
import { renderMarkdown } from './render-markdown';

// Combined-digest renderer (ADR 0002, Phase D): one reading-oriented
// markdown file for a whole batch. Each document already renders with its
// own `# author/title` header and `> Source:` footer, so the digest is the
// rendered documents joined by separators — Document[] → string, nothing
// per-item beyond what renderMarkdown emits.
export function renderDigest(docs: Document[]): string {
  return docs.map((doc) => renderMarkdown(doc).trim()).join('\n\n---\n\n') + '\n';
}
