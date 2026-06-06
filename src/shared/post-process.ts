import type { ExtractedContent, TweetMetadata } from '../types/messages';
import { isAllowedImageUrl } from './media';

export interface PostProcessOptions {
  includeMetadata: boolean;
  downloadImages: boolean;
  inlineStats?: boolean;
  obsidianFriendly?: boolean;
  filenameTemplate?: string;
  // Comma-separated tags template used only by the Obsidian-friendly schema.
  // Same placeholder vocabulary as filename templates. Empty/undefined falls
  // back to DEFAULT_TAGS_TEMPLATE so existing users see no change.
  obsidianTagsTemplate?: string;
  // Per-field opt-out for the YAML frontmatter. Undefined → emit every field
  // (legacy behavior). A `false` entry suppresses that field; missing keys are
  // treated as enabled so newly-added fields don't silently disappear for
  // users with an older saved map.
  frontmatterFields?: Record<string, boolean>;
}

export const FRONTMATTER_FIELDS_DEFAULT = [
  'author',
  'handle',
  'source',
  'date',
  'type',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'views',
] as const;

export const FRONTMATTER_FIELDS_OBSIDIAN = [
  'title',
  'source',
  'author',
  'author_name',
  'handle',
  'published',
  'created',
  'type',
  'description',
  'tags',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'views',
] as const;

export const FILENAME_PLACEHOLDERS = ['date', 'datetime', 'handle', 'author', 'id', 'slug', 'type'] as const;
export const TAGS_PLACEHOLDERS = FILENAME_PLACEHOLDERS;

// Reproduces the pre-feature behavior exactly: `tags: [clippings, x, <type>]`
// in the Obsidian-friendly frontmatter. Persisted as the empty-string sentinel
// in storage so the default can evolve without forcing a re-save.
export const DEFAULT_TAGS_TEMPLATE = 'clippings, x, {type}';

const DESCRIPTION_MAX_CHARS = 200;

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoToDateOnly(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : iso;
}

// Pull a short, plain-text preview from the markdown body. Drops the
// author H1, frontmatter, blockquotes, list bullets, link/image syntax,
// and emoji-prefixed UI lines so the description reads like prose.
function buildDescription(markdown: string): string {
  let body = markdown.replace(/^---[\s\S]*?---\s*/m, '');
  body = body.replace(/^# .*$/m, '');
  const lines = body.split('\n');
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) continue;
    if (line.startsWith('---')) continue;
    if (/^!\[/.test(line)) continue;
    kept.push(line);
    if (kept.join(' ').length >= DESCRIPTION_MAX_CHARS + 80) break;
  }
  let text = kept.join(' ');
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/[*_`]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= DESCRIPTION_MAX_CHARS) return text;
  return text.slice(0, DESCRIPTION_MAX_CHARS).replace(/\s+\S*$/, '') + '…';
}

function buildTitle(data: ExtractedContent): string {
  if (data.type === 'article' && data.title) return data.title;
  const noun = data.type === 'thread' ? 'Thread' : 'Post';
  return `${noun} by ${data.author.handle} on X`;
}

function yamlEscape(value: string): string {
  // Quote when the value contains characters that would break a bare scalar.
  if (/[:#\n"'\\]/.test(value) || /^[\s-]/.test(value) || /\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `"${value}"`;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return (k < 10 ? k.toFixed(1) : Math.round(k).toString()) + 'K';
  }
  const m = n / 1_000_000;
  return (m < 10 ? m.toFixed(1) : Math.round(m).toString()) + 'M';
}

function buildStatsLine(m: TweetMetadata): string {
  const parts: string[] = [];
  if (m.replies !== undefined) parts.push(`💬 ${formatCount(m.replies)}`);
  if (m.reposts !== undefined) parts.push(`🔁 ${formatCount(m.reposts)}`);
  if (m.likes !== undefined) parts.push(`❤️ ${formatCount(m.likes)}`);
  if (m.bookmarks !== undefined) parts.push(`🔖 ${formatCount(m.bookmarks)}`);
  if (m.views !== undefined) parts.push(`👁 ${formatCount(m.views)}`);
  return parts.join(' · ');
}

export interface PostProcessResult {
  markdown: string;
  filename: string;
  type: ExtractedContent['type'];
  images: { url: string; filename: string }[];
}

// Single source of truth: "Save images locally" only takes effect when the
// action actually writes a file. Clipboard copies must keep absolute URLs
// since they can't carry sibling files.
export function resolveDownloadImages(
  action: 'download' | 'copy',
  userToggle: boolean
): boolean {
  return action === 'download' && userToggle === true;
}

// Strip characters that would break a filename on at least one major FS.
// Leaves Unicode letters/digits alone — Chrome's downloads.download sanitizes
// further on Windows, but we want to keep e.g. CJK handles readable.
function sanitizeFilenamePart(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function slugify(text: string, max = 60): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

// Compact filesystem-safe datetime: YYYY-MM-DD_HHMM (UTC). Avoids colons
// (Windows) and spaces.
function isoToDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return isoToDateOnly(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

// Plain-text preview for {slug} on non-article tweets: drop frontmatter, the
// author H1, blockquote markers, and link/image syntax so the slug reads like
// the tweet body.
function previewForSlug(data: ExtractedContent): string {
  if (data.type === 'article' && data.title) return data.title;
  let body = data.markdown.replace(/^---[\s\S]*?---\s*/m, '');
  body = body.replace(/^# .*$/m, '');
  body = body.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  body = body.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  body = body.replace(/^[>\s-]+/gm, '');
  body = body.replace(/[*_`]/g, '');
  return body.replace(/\s+/g, ' ').trim();
}

const FILENAME_MAX_CHARS = 120;

export function applyFilenameTemplate(template: string, data: ExtractedContent): string {
  const handle = data.author.handle.replace('@', '');
  const replacements: Record<string, string> = {
    date: isoToDateOnly(data.date),
    datetime: isoToDateTime(data.date),
    handle,
    author: data.author.name,
    id: data.tweetId,
    slug: slugify(previewForSlug(data)),
    type: data.type,
  };

  let rendered = template.replace(
    /\{(date|datetime|handle|author|id|slug|type)\}/g,
    (_, key: string) => sanitizeFilenamePart(replacements[key] ?? '')
  );
  rendered = rendered.replace(/\.md$/i, '');
  rendered = rendered.replace(/[/\\:*?"<>|]/g, '');
  rendered = rendered.replace(/\s+/g, ' ').trim();
  if (rendered.length > FILENAME_MAX_CHARS) {
    rendered = rendered.slice(0, FILENAME_MAX_CHARS).trim();
  }
  return rendered ? `${rendered}.md` : '';
}

// Obsidian tag rules: no whitespace, no `#`, no slashes/backslashes, no commas.
// Spaces collapse to `-`; everything else illegal is dropped. Empty result
// means the tag was unusable and should be filtered out by the caller.
function sanitizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[#,/\\]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function applyTagsTemplate(template: string, data: ExtractedContent): string[] {
  const handle = data.author.handle.replace('@', '');
  const replacements: Record<string, string> = {
    date: isoToDateOnly(data.date),
    datetime: isoToDateTime(data.date),
    handle,
    author: data.author.name,
    id: data.tweetId,
    slug: slugify(previewForSlug(data)),
    type: data.type,
  };

  const knownPlaceholder = /\{(date|datetime|handle|author|id|slug|type)\}/g;
  // Non-global: we only need a yes/no answer per piece, and a /g RegExp
  // retains `lastIndex` between .test() calls which causes intermittent misses.
  const anyPlaceholder = /\{[^}]+\}/;

  return template
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const resolved = piece.replace(knownPlaceholder, (_, key: string) => replacements[key] ?? '');
      // Anything still bracketed is an unknown placeholder — autocomplete steers
      // users away from these but a manual typer can still produce them; drop
      // the whole tag rather than emit garbage like `#foo-{bar}`.
      if (anyPlaceholder.test(resolved)) return '';
      return sanitizeTag(resolved);
    })
    .filter(Boolean);
}

export function buildFilename(data: ExtractedContent, template?: string): string {
  if (template && template.trim()) {
    const fromTemplate = applyFilenameTemplate(template.trim(), data);
    if (fromTemplate) return fromTemplate;
  }

  const handle = data.author.handle.replace('@', '');
  const id = data.tweetId;

  if (data.type === 'article' && data.title) {
    return `${handle}-${slugify(data.title)}.md`;
  }

  return `${handle}-${id}.md`;
}

function stripSourceFooter(md: string): string {
  return md.replace(/\n+---\n+> Source:.*\n> Date:.*$/s, '');
}

export function postProcess(
  data: ExtractedContent,
  opts: PostProcessOptions
): PostProcessResult {
  const baseFilename = buildFilename(data, opts.filenameTemplate);
  let finalMarkdown = data.markdown;

  if (opts.includeMetadata) {
    finalMarkdown = stripSourceFooter(finalMarkdown);

    const m = data.metadata;
    const fields = opts.frontmatterFields;
    const includeField = (key: string) => !fields || fields[key] !== false;
    const lines = ['---'];

    if (opts.obsidianFriendly) {
      // Obsidian-friendly schema: wikilink author for backlinks, split
      // published/created dates, synthesized title, tags array. Engagement
      // metrics still emitted at the bottom for Dataview queries.
      if (includeField('title')) lines.push(`title: ${yamlEscape(buildTitle(data))}`);
      if (includeField('source')) lines.push(`source: "${data.sourceUrl}"`);
      if (includeField('author')) lines.push(`author: "[[${data.author.handle}]]"`);
      if (includeField('author_name')) lines.push(`author_name: ${yamlEscape(data.author.name)}`);
      if (includeField('handle')) lines.push(`handle: "${data.author.handle}"`);
      if (includeField('published')) lines.push(`published: ${isoToDateOnly(data.date)}`);
      if (includeField('created')) lines.push(`created: ${todayISODate()}`);
      if (includeField('type')) lines.push(`type: ${data.type}`);
      if (includeField('description')) {
        const desc = buildDescription(finalMarkdown);
        if (desc) lines.push(`description: ${yamlEscape(desc)}`);
      }
      if (includeField('tags')) {
        const template = (opts.obsidianTagsTemplate ?? '').trim() || DEFAULT_TAGS_TEMPLATE;
        const tags = applyTagsTemplate(template, data);
        if (tags.length > 0) lines.push(`tags: [${tags.join(', ')}]`);
      }
    } else {
      if (includeField('author')) lines.push(`author: "${data.author.name}"`);
      if (includeField('handle')) lines.push(`handle: "${data.author.handle}"`);
      if (includeField('source')) lines.push(`source: "${data.sourceUrl}"`);
      if (includeField('date')) lines.push(`date: ${data.date}`);
      if (includeField('type')) lines.push(`type: ${data.type}`);
    }

    if (m) {
      if (m.likes !== undefined && includeField('likes')) lines.push(`likes: ${m.likes}`);
      if (m.reposts !== undefined && includeField('reposts')) lines.push(`reposts: ${m.reposts}`);
      if (m.replies !== undefined && includeField('replies')) lines.push(`replies: ${m.replies}`);
      if (m.bookmarks !== undefined && includeField('bookmarks')) lines.push(`bookmarks: ${m.bookmarks}`);
      if (m.views !== undefined && includeField('views')) lines.push(`views: ${m.views}`);
    }
    lines.push('---', '');
    finalMarkdown = lines.join('\n') + finalMarkdown;
  }

  if (opts.inlineStats && data.metadata) {
    const line = buildStatsLine(data.metadata);
    if (line) {
      // For threads, engagement stats belong to the first tweet — place them
      // before the first `---` separator (which divides tweet 1 from tweet 2).
      // The first `---` in the body (after any frontmatter) is the thread
      // separator; the source footer uses `---` too but sits after all tweets.
      const isThread = data.type === 'thread';
      if (isThread) {
        // Skip past frontmatter (if present) to find the first thread separator.
        const fmEnd = finalMarkdown.startsWith('---')
          ? finalMarkdown.indexOf('---', finalMarkdown.indexOf('\n') + 1)
          : -1;
        const searchStart = fmEnd >= 0 ? fmEnd + 3 : 0;
        const sepIdx = finalMarkdown.indexOf('\n---\n', searchStart);
        if (sepIdx >= 0) {
          finalMarkdown =
            finalMarkdown.slice(0, sepIdx) +
            `\n\n${line}` +
            finalMarkdown.slice(sepIdx);
        } else {
          // Single-tweet thread or no separator found — fall through to default.
          finalMarkdown = finalMarkdown.replace(/\s*$/, '') + `\n\n${line}\n`;
        }
      } else {
        const footerRe = /\n+---\n+> Source:/;
        if (footerRe.test(finalMarkdown)) {
          finalMarkdown = finalMarkdown.replace(footerRe, `\n\n${line}\n\n---\n> Source:`);
        } else {
          finalMarkdown = finalMarkdown.replace(/\s*$/, '') + `\n\n${line}\n`;
        }
      }
    }
  }

  const imagesToDownload: { url: string; filename: string }[] = [];

  if (opts.downloadImages) {
    const dirName = baseFilename.replace('.md', '');

    finalMarkdown = finalMarkdown.replace(
      /!\[(.*?)\]\((https:\/\/[^)]+)\)/g,
      (match, alt, imgUrl) => {
        if (!isAllowedImageUrl(imgUrl)) {
          return match;
        }
        // Link-card OG previews are belong to the destination site, not the
        // tweet's own media — keep them as remote URLs so we don't accumulate
        // third-party thumbnails on disk.
        if (alt === 'Link card preview') {
          return match;
        }

        try {
          const urlObj = new URL(imgUrl);
          let fname = urlObj.pathname.split('/').pop() || 'image';

          const formatMatch = imgUrl.match(/format=([a-zA-Z0-9]+)/);
          if (formatMatch && !fname.includes('.')) {
            fname += `.${formatMatch[1]}`;
          }
          if (!fname.includes('.')) {
            fname += '.jpg';
          }

          fname = fname.replace(/[^a-zA-Z0-9_.-]/g, '_');
          const localPath = `${dirName}/${fname}`;

          if (!imagesToDownload.find((i) => i.url === imgUrl)) {
            imagesToDownload.push({ url: imgUrl, filename: localPath });
          }

          return `![${alt}](${localPath})`;
        } catch {
          return match;
        }
      }
    );
  }

  return {
    markdown: finalMarkdown,
    filename: baseFilename,
    type: data.type,
    images: imagesToDownload,
  };
}
