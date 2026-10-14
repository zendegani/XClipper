import { describe, expect, it } from 'vitest';
import { itemFiles, planBatch, renderItem } from '../src/background/batch-sink';
import type { Document } from '../src/ast/types';
import { markdownOptions } from '../src/shared/post-process';
import { DEFAULT_SETTINGS, type BatchFormat, type BatchOutput } from '../src/shared/settings';

// One set of batch output rules for every engine (#138). Manual, Auto and
// Super all plan a run through planBatch, so these cases hold for each of them.

const FORMATS: BatchFormat[] = ['md', 'txt', 'html', 'json', 'csv'];
const OUTPUTS: BatchOutput[] = ['separate', 'both', 'combined'];
// The popup's save-locally control: Off | Images | Media.
const SAVE_LOCALLY = [
  { name: 'off', downloadImages: false, saveVideos: false },
  { name: 'images', downloadImages: true, saveVideos: false },
  { name: 'media', downloadImages: true, saveVideos: true },
];
const combinations = FORMATS.flatMap((format) =>
  OUTPUTS.flatMap((output) =>
    [false, true].flatMap((batchZip) => SAVE_LOCALLY.map((local) => ({ format, output, batchZip, ...local })))
  )
);

describe('planBatch', () => {
  it.each(combinations)('$format / $output / zip $batchZip / save $name', (c) => {
    const plan = planBatch({ ...DEFAULT_SETTINGS, ...c }, c.format, c.output);
    const output = c.format === 'csv' ? 'combined' : c.output;
    const perItemFiles = output !== 'combined';

    // CSV has no per-item form: one combined file.
    expect(plan.output).toBe(output);
    // Local images can't go into the archive, so they turn zip off for Markdown.
    expect(plan.zip).toBe(c.batchZip && perItemFiles && !(c.format === 'md' && c.downloadImages));
    // Videos ride a post's own Markdown file (#136: Both has one too).
    expect(plan.localVideo).toBe(c.format === 'md' && perItemFiles && c.saveVideos && c.downloadImages);
    expect(plan.zip && plan.localVideo).toBe(false);
  });

  it('renders Markdown with the same options as a single download', () => {
    const settings = { ...DEFAULT_SETTINGS, obsidianFriendly: true, obsidianTagsTemplate: 'reading' };
    expect(planBatch(settings, 'md', 'separate').markdown).toEqual(markdownOptions(settings, 'download'));
  });

  it('survives storage: a Manual job keeps its plan across a worker restart', () => {
    const plan = planBatch({ ...DEFAULT_SETTINGS, inlineStats: true }, 'html', 'both');
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

const POSTER = 'https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg';
const MP4 = 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/clip.mp4';
const PHOTO = 'https://pbs.twimg.com/media/photo.jpg';

// A post with a photo and a video whose MP4 is already known (the shape GraphQL
// Batch maps, and Manual's once the orchestrator has resolved its videos).
const videoDoc: Document = {
  version: 1,
  metadata: {
    type: 'tweet',
    sourceUrl: 'https://x.com/jane/status/1',
    tweetId: '1',
    author: { name: 'Jane', handle: 'jane' },
    date: '2026-01-02T10:00:00.000Z',
  },
  body: {
    type: 'tweet',
    author: { name: 'Jane', handle: 'jane' },
    date: '2026-01-02T10:00:00.000Z',
    tweetId: '1',
    text: [{ type: 'text', value: 'Look' }],
    media: [
      { kind: 'image', url: PHOTO },
      { kind: 'video', url: MP4, posterUrl: POSTER },
    ],
  },
};

const MEDIA = { ...DEFAULT_SETTINGS, downloadImages: true, saveVideos: true };

function filesFor(settings: typeof DEFAULT_SETTINGS, format: BatchFormat, output: BatchOutput) {
  const plan = planBatch(settings, format, output);
  const rendered = renderItem(videoDoc, plan);
  return { rendered, files: itemFiles(videoDoc, rendered, 'post.md', plan) };
}

describe('itemFiles', () => {
  it('saves the Markdown with its images and videos, linked locally', () => {
    const { rendered, files } = filesFor(MEDIA, 'md', 'both');
    const md = files.find((f) => f.path === 'post.md');
    const remote = files.filter((f) => 'url' in f).map((f) => ('url' in f ? f.url : ''));

    expect(remote.sort()).toEqual([PHOTO, POSTER, MP4].sort());
    expect(md && 'content' in md && md.content).toBe(rendered.markdown);
    expect(rendered.markdown).not.toContain(`(${MP4})`);
    expect(rendered.markdown).toMatch(/\[▶ Video\]\([^)]*clip\.mp4\)/);
  });

  it('leaves media on X when nothing is saved locally', () => {
    const { rendered, files } = filesFor(DEFAULT_SETTINGS, 'md', 'separate');
    expect(files.map((f) => f.path)).toEqual(['post.md']);
    expect(rendered.markdown).toContain(PHOTO);
  });

  it('writes one file in the chosen format, and no media, for other formats', () => {
    const { files } = filesFor(MEDIA, 'html', 'separate');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'post.html', mime: 'text/html' });
  });

  it('puts no remote file in a zip run', () => {
    const { files } = filesFor({ ...DEFAULT_SETTINGS, batchZip: true }, 'md', 'separate');
    expect(files.every((f) => 'content' in f)).toBe(true);
  });
});
