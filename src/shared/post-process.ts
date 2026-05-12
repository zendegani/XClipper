import type { ExtractedContent, TweetMetadata } from '../types/messages';
import { isAllowedImageUrl } from './media';

export interface PostProcessOptions {
  includeMetadata: boolean;
  downloadImages: boolean;
  inlineStats?: boolean;
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

export function buildFilename(data: ExtractedContent): string {
  const handle = data.author.handle.replace('@', '');
  const id = data.tweetId;

  if (data.type === 'article' && data.title) {
    const slug = data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    return `${handle}-${slug}.md`;
  }

  return `${handle}-${id}.md`;
}

function stripSourceFooter(md: string): string {
  return md.replace(/\n+---\n+> Source:.*\n> Date:.*$/s, '');
}

function insertBeforeSourceFooter(md: string, block: string): string {
  const footerRe = /\n+---\n+> Source:/;
  if (footerRe.test(md)) {
    return md.replace(footerRe, `\n\n${block}\n\n---\n> Source:`);
  }
  return md.replace(/\s*$/, '') + `\n\n${block}\n`;
}

export function postProcess(
  data: ExtractedContent,
  opts: PostProcessOptions
): PostProcessResult {
  const baseFilename = buildFilename(data);
  let finalMarkdown = data.markdown;

  if (opts.includeMetadata) {
    finalMarkdown = stripSourceFooter(finalMarkdown);

    const m = data.metadata;
    const lines = ['---'];
    lines.push(`author: "${data.author.name}"`);
    lines.push(`handle: "${data.author.handle}"`);
    lines.push(`source: "${data.sourceUrl}"`);
    lines.push(`date: ${data.date}`);
    lines.push(`type: ${data.type}`);
    if (data.thread) {
      lines.push(`thread_complete: ${data.thread.complete}`);
      lines.push(`thread_stop_reason: "${data.thread.stopReason}"`);
      lines.push(`thread_collected_count: ${data.thread.collectedCount}`);
      lines.push(`thread_failed_count: ${data.thread.failedCount}`);
      lines.push(`thread_steps: ${data.thread.steps}`);
      lines.push(`thread_duration_ms: ${data.thread.durationMs}`);
      // Single-post collections labeled type: thread to preserve diagnostics.
      // The flag makes that disambiguation obvious to readers of the frontmatter.
      if (!data.thread.complete && data.thread.collectedCount <= 1) {
        lines.push(`thread_degraded: true`);
      }
    }
    if (m) {
      if (m.likes !== undefined) lines.push(`likes: ${m.likes}`);
      if (m.reposts !== undefined) lines.push(`reposts: ${m.reposts}`);
      if (m.replies !== undefined) lines.push(`replies: ${m.replies}`);
      if (m.bookmarks !== undefined) lines.push(`bookmarks: ${m.bookmarks}`);
      if (m.views !== undefined) lines.push(`views: ${m.views}`);
    }
    lines.push('---', '');
    finalMarkdown = lines.join('\n') + finalMarkdown;
  }

  if (opts.inlineStats && data.metadata) {
    const line = buildStatsLine(data.metadata);
    if (line) {
      finalMarkdown = insertBeforeSourceFooter(finalMarkdown, line);
    }
  }

  if (data.thread && !data.thread.complete) {
    const comment =
      `<!-- tweet2md: thread extraction may be incomplete; ` +
      `tweet_id=${data.tweetId}; ` +
      `stop_reason=${data.thread.stopReason}; ` +
      `collected=${data.thread.collectedCount}; ` +
      `failed=${data.thread.failedCount}; ` +
      `steps=${data.thread.steps}; ` +
      `duration_ms=${data.thread.durationMs} -->`;
    finalMarkdown = insertBeforeSourceFooter(finalMarkdown, comment);
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
