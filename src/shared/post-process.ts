import type { ExtractedContent } from '../types/messages';

export interface PostProcessOptions {
  includeMetadata: boolean;
  downloadImages: boolean;
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

  const imagesToDownload: { url: string; filename: string }[] = [];

  if (opts.downloadImages) {
    const dirName = baseFilename.replace('.md', '');

    finalMarkdown = finalMarkdown.replace(
      /!\[(.*?)\]\((https:\/\/[^)]+)\)/g,
      (match, alt, imgUrl) => {
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
