// Alternate single-export formats (issue #54): HTML, JSON, TXT, CSV.
//
// Markdown / PDF have their own established paths (postProcess + renderPdfHtml).
// These four reuse what already exists:
//   - HTML reuses renderPdfHtml (the same standalone document the PDF flow prints)
//   - JSON serializes the canonical AST Document (same shape as the batch JSON sink)
//   - TXT strips markup from the AST-rendered Markdown, keeping link URLs
//   - CSV emits the active frontmatter fields as columns plus a `text` column
//     with the post body (one row per post)
//
// The popup picks the format; this module turns an ExtractedContent (+ the
// user's current settings) into { content, mime, ext } ready for DOWNLOAD_MD.

import type { ExtractedContent } from '../types/messages';
import { renderPdfHtml } from '../ast/render-pdf-html';
import { renderMarkdownBody } from '../ast/render-markdown';
import {
  FRONTMATTER_FIELDS_DEFAULT,
  FRONTMATTER_FIELDS_OBSIDIAN,
  DEFAULT_TAGS_TEMPLATE,
  applyTagsTemplate,
  buildTitle,
  buildDescription,
  isoToDateOnly,
  todayISODate,
} from './post-process';

export type ExportFormat = 'html' | 'json' | 'txt' | 'csv';

export interface FormatExport {
  content: string;
  mime: string;
  ext: string;
}

export interface FormatOptions {
  // Render engagement metrics on HTML tweet cards (mirrors the PDF flow).
  includeEngagement?: boolean;
  // Selects which frontmatter field set drives the CSV columns.
  obsidianFriendly?: boolean;
  // Per-field opt-out, same map the Markdown frontmatter uses. Missing key =
  // enabled.
  frontmatterFields?: Record<string, boolean>;
  // Tags template for the CSV `tags` column (Obsidian field set only).
  obsidianTagsTemplate?: string;
}

export function buildFormatExport(
  format: ExportFormat,
  data: ExtractedContent,
  opts: FormatOptions = {}
): FormatExport {
  switch (format) {
    case 'html': {
      if (!data.body) throw new Error('HTML export needs the document AST.');
      return {
        content: renderPdfHtml(data.body, { includeEngagement: opts.includeEngagement }),
        mime: 'text/html',
        ext: 'html',
      };
    }
    case 'json':
      // Prefer the structured AST; fall back to the wire object for older
      // producers that didn't attach `body`.
      return {
        content: JSON.stringify(data.body ?? data, null, 2),
        mime: 'application/json',
        ext: 'json',
      };
    case 'txt':
      return { content: markdownToPlainText(data.markdown), mime: 'text/plain', ext: 'txt' };
    case 'csv':
      return { content: buildCsvRow(data, opts), mime: 'text/csv', ext: 'csv' };
  }
}

// ─── TXT ────────────────────────────────────────────────────────────
//
// The AST-rendered Markdown (data.markdown) is already plain prose with light
// markup. Strip the markup but keep link URLs so the text stays useful offline.
export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      // images: ![alt](url) → "alt: url" (or just the URL when alt is empty)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) =>
        alt ? `${alt}: ${url}` : url
      )
      // links: [text](url) → "text (url)", but collapse when text === url
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) =>
        text === url ? url : `${text} (${url})`
      )
      // headings: drop leading #'s
      .replace(/^#{1,6}\s+/gm, '')
      // blockquote markers
      .replace(/^>\s?/gm, '')
      // bold / italic / inline code markers
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      // collapse 3+ blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

// ─── CSV ────────────────────────────────────────────────────────────
//
// One header row + one data row. Columns are the active frontmatter fields for
// the current mode (Default or Obsidian-friendly), honoring the per-field
// toggles — the same selection the Markdown frontmatter uses. CSV is inherently
// the metadata export, so it does not gate on the "Include metadata" toggle.
export function buildCsvRow(data: ExtractedContent, opts: FormatOptions = {}): string {
  return buildCsvTable([data], opts);
}

// CSV table: one header row + one data row per item. A trailing `text` column
// carries the post body as plain text — the frontmatter fields alone are just
// metadata, so without it the export has no actual content. Used for single
// export (one row) and the batch flow (where CSV is always one combined file).
// Curated column order for spreadsheet readability — independent of the YAML
// field order (which is cosmetic). Covers every field across the Default and
// Obsidian sets; only the active, enabled ones for the current set appear, in
// this sequence. The long `text` body always trails (appended below).
const CSV_COLUMN_ORDER = [
  'date', 'published', 'created',
  'author', 'author_name', 'handle', 'title',
  'type', 'description', 'tags',
  'likes', 'reposts', 'replies', 'bookmarks', 'views',
  'source',
];

export function buildCsvTable(rows: ExtractedContent[], opts: FormatOptions = {}): string {
  const fieldOrder = opts.obsidianFriendly ? FRONTMATTER_FIELDS_OBSIDIAN : FRONTMATTER_FIELDS_DEFAULT;
  const enabled = opts.frontmatterFields;
  const includeField = (key: string) => !enabled || enabled[key] !== false;

  // Active fields for the current set (a disabled toggle drops its column),
  // reordered for CSV; the body `text` column is always last.
  const active: string[] = fieldOrder.filter(includeField);
  const columns = [
    ...CSV_COLUMN_ORDER.filter((k) => active.includes(k)),
    ...active.filter((k) => !CSV_COLUMN_ORDER.includes(k)),
    'text',
  ];

  const header = columns.map(csvEscape).join(',');
  const lines = rows.map((data) =>
    columns
      .map((key) => (key === 'text' ? csvBodyText(data) : fieldValue(key, data, opts)))
      .map(csvEscape)
      .join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

// Just the post content for the `text` column — no author header or Source/Date
// footer (those already have their own columns). Falls back to the full body
// markdown if the AST isn't on the wire (older producers).
function csvBodyText(data: ExtractedContent): string {
  const md = data.body ? renderMarkdownBody(data.body) : data.markdown;
  return markdownToPlainText(md).trim();
}

function fieldValue(key: string, data: ExtractedContent, opts: FormatOptions): string {
  const m = data.metadata;
  switch (key) {
    case 'title':
      return buildTitle(data);
    case 'source':
      return data.sourceUrl;
    case 'author':
      // Default field set shows the display name; the Obsidian set reserves
      // `author` for the handle (it's the wikilink target there) and carries
      // the name separately in `author_name`.
      return opts.obsidianFriendly ? data.author.handle : data.author.name;
    case 'author_name':
      return data.author.name;
    case 'handle':
      return data.author.handle;
    case 'date':
      return data.date;
    case 'published':
      return isoToDateOnly(data.date);
    case 'created':
      return todayISODate();
    case 'type':
      return data.type;
    case 'description':
      return buildDescription(data.markdown);
    case 'tags': {
      const template = (opts.obsidianTagsTemplate ?? '').trim() || DEFAULT_TAGS_TEMPLATE;
      return applyTagsTemplate(template, data).join(' ');
    }
    case 'likes':
      return m?.likes !== undefined ? String(m.likes) : '';
    case 'reposts':
      return m?.reposts !== undefined ? String(m.reposts) : '';
    case 'replies':
      return m?.replies !== undefined ? String(m.replies) : '';
    case 'bookmarks':
      return m?.bookmarks !== undefined ? String(m.bookmarks) : '';
    case 'views':
      return m?.views !== undefined ? String(m.views) : '';
    default:
      return '';
  }
}

// RFC 4180: quote when the value contains a comma, quote, CR or LF; escape
// embedded quotes by doubling them.
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
