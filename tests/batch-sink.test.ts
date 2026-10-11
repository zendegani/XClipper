import { describe, expect, it } from 'vitest';
import { planBatch } from '../src/background/batch-sink';
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
