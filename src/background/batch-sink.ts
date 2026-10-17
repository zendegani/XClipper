// Shared batch output (ADR 0002 #11, generalized for ADR 0003): the rules,
// the render, and the writers for every engine — only acquisition differs.
//
// planBatch decides what a run writes, renderItem and itemFiles turn one
// post's AST into its files (pure, so the rules are testable without chrome),
// and the write* functions are the only side effects: the per-item files, the
// per-job data.json, and the one combined file. They take a `folder`, not a
// ManualBatchJob, so Scroll (manual-batch.ts) and Auto Full/Auto Fast (graphql-batch.ts)
// share them unchanged.

import type { Document } from '../ast/types';
import { renderDigest } from '../ast/render-digest';
import { renderMarkdown } from '../ast/render-markdown';
import { docToExtracted } from '../shared/extracted-content';
import { renderPdfHtmlMany } from '../ast/render-pdf-html';
import type { BatchFormat, BatchOutput, Settings } from '../shared/settings';
import {
  buildFormatExport,
  buildCsvTable,
  markdownToPlainText,
  type ExportFormat,
  type FormatOptions,
} from '../shared/export-formats';
import {
  markdownOptions,
  postProcess,
  resolveDownloadImages,
  type PostProcessOptions,
  type PostProcessResult,
} from '../shared/post-process';
import { videoAttachments } from '../shared/local-video';
import type { BatchFailure } from './batch-state';
import { isAllowedImageUrl, sanitizeFilePath } from './security';
import { buildZip, zipDataUrl, type ZipEntry } from './zip';

export interface StoredItem {
  url: string;
  filename: string;
  doc: Document;
}

export interface BuiltFile {
  content: string;
  mime: string;
  ext: string;
}

// The job-level fields the data.json manifest records (decoupled from ManualBatchJob).
export interface JobMeta {
  jobId: string;
  status: string;
  completed: number;
  failures: BatchFailure[];
}

// Every output decision for one batch run, made once from the settings at its
// start. All engines plan through here, so Scroll and Auto Full/Auto Fast can't drift
// apart on which files a run writes (#136). JSON-serializable: a Scroll job
// keeps it in storage so a service-worker restart resumes with the same plan.
export interface BatchPlan {
  format: BatchFormat;
  // CSV is metadata-only — a per-item CSV is a one-row file — so a CSV run is
  // always one combined file, whatever grouping the user picked.
  output: BatchOutput;
  // Pack the per-item files into one archive. Local images turn it off for
  // Markdown: image bytes can't be fetched into the zip.
  zip: boolean;
  // Save each post's MP4s next to its Markdown. Only a per-item Markdown file
  // links them; saveVideos is the Media position of the save-locally control.
  localVideo: boolean;
  markdown: PostProcessOptions;
  formatOptions: FormatOptions;
}

export function planBatch(settings: Settings, format: BatchFormat, output: BatchOutput): BatchPlan {
  const out = format === 'csv' ? 'combined' : output;
  const localImages = resolveDownloadImages('download', settings.downloadImages);
  return {
    format,
    output: out,
    zip: settings.batchZip && out !== 'combined' && !(localImages && format === 'md'),
    localVideo: out !== 'combined' && format === 'md' && settings.saveVideos && localImages,
    markdown: markdownOptions(settings, 'download'),
    formatOptions: {
      includeEngagement: settings.inlineStats,
      obsidianFriendly: settings.obsidianFriendly,
      frontmatterFields: settings.obsidianFriendly ? settings.frontmatterFieldsObsidian : settings.frontmatterFields,
      obsidianTagsTemplate: settings.obsidianTagsTemplate,
      includeMetadata: settings.includeMetadata,
    },
  };
}

// A file a batch writes, relative to the run folder: text it carries itself,
// or a remote image/video Chrome fetches.
export type OutFile = { path: string; content: string; mime: string } | { path: string; url: string };

// The one place a batch post's Markdown is made, for every engine. Its file
// name comes from here too, before the caller de-duplicates it. Videos must
// already carry their MP4s (Auto Full/Auto Fast maps them; Scroll resolves them first).
export function renderItem(doc: Document, plan: BatchPlan): PostProcessResult {
  return postProcess(docToExtracted(doc, plan.localVideo ? { includeVideoLinks: true } : undefined), {
    ...plan.markdown,
    videoAttachments: plan.localVideo ? videoAttachments(doc) : undefined,
  });
}

// One post's files under its de-duplicated name. Markdown brings its local
// images and videos; other formats are derived from the AST and carry none.
export function itemFiles(
  doc: Document,
  rendered: Pick<PostProcessResult, 'markdown' | 'images'>,
  filename: string,
  plan: BatchPlan
): OutFile[] {
  if (plan.format === 'md') {
    return [
      ...rendered.images.map((img) => ({ path: img.filename, url: img.url })),
      { path: filename, content: rendered.markdown, mime: 'text/markdown' },
    ];
  }
  const built = buildFormatExport(plan.format as ExportFormat, docToExtracted(doc), plan.formatOptions);
  return [{ path: filename.replace(/\.md$/i, '') + '.' + built.ext, content: built.content, mime: built.mime }];
}

// One combined file for the whole batch in the chosen format.
export function buildCombined(format: BatchFormat, docs: Document[], opts: FormatOptions): BuiltFile {
  switch (format) {
    case 'md':
      return { content: renderDigest(docs), mime: 'text/markdown', ext: 'md' };
    case 'txt':
      return {
        content: docs.map((d) => markdownToPlainText(renderMarkdown(d))).join('\n\n---\n\n') + '\n',
        mime: 'text/plain',
        ext: 'txt',
      };
    case 'html':
      return {
        content: renderPdfHtmlMany(docs, { includeEngagement: opts.includeEngagement }),
        mime: 'text/html',
        ext: 'html',
      };
    case 'json':
      return { content: JSON.stringify(docs, null, 2), mime: 'application/json', ext: 'json' };
    case 'csv':
      return { content: buildCsvTable(docs.map((doc) => docToExtracted(doc)), opts), mime: 'text/csv', ext: 'csv' };
  }
}

// Download pacing: a big batch can fire thousands of downloads (an Auto Fast
// run alone writes 1000s of files, plus images). Unthrottled, they all hit
// Chrome's browser process at once — data-URL decode, downloads-UI updates,
// history-DB inserts, disk writes — and the whole browser janks until the
// queue drains. A small in-flight cap lets disk/network set the pace while
// Chrome stays responsive. Failures resolve rather than reject — a batch never
// dies on one bad file, matching the old fire-and-forget behavior.
const MAX_INFLIGHT_DOWNLOADS = 8;
let inflight = 0;
const waiting: (() => void)[] = [];

// The one place a file download starts. Firefox refuses data: URLs here, and
// throws on refused options where Chrome sets lastError. Its background is an
// event page with URL.createObjectURL, so there a data: URL becomes a blob: URL,
// revoked once the download ends; Chrome's service worker has no
// createObjectURL and keeps the data: URL. Never rejects. onEnd runs once the
// file is written or interrupted.
export async function startFileDownload(
  options: chrome.downloads.DownloadOptions,
  onEnd: () => void = () => {}
): Promise<{ downloadId: number } | { error: string }> {
  let blobUrl: string | undefined;
  const release = (): void => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
  try {
    if (options.url.startsWith('data:') && typeof URL.createObjectURL === 'function') {
      blobUrl = URL.createObjectURL(await (await fetch(options.url)).blob());
    }
    return await new Promise((resolve) => {
      chrome.downloads.download(blobUrl ? { ...options, url: blobUrl } : options, (id) => {
        const error = chrome.runtime.lastError?.message;
        if (error || id === undefined) {
          release();
          return resolve({ error: error ?? 'Download did not start' });
        }
        const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
          const state = delta.state?.current;
          if (delta.id === id && (state === 'complete' || state === 'interrupted')) {
            chrome.downloads.onChanged.removeListener(onChanged);
            release();
            onEnd();
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
        resolve({ downloadId: id });
      });
    });
  } catch (err) {
    release();
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function downloadThrottled(options: chrome.downloads.DownloadOptions): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      inflight--;
      resolve();
      waiting.shift()?.();
    };
    const start = (): void => {
      inflight++;
      void startFileDownload(options, finish).then((r) => {
        if ('error' in r) finish();
      });
    };
    if (inflight < MAX_INFLIGHT_DOWNLOADS) start();
    else waiting.push(start);
  });
}

// Generic data-URL download into the job folder. Used for the Markdown items,
// the alternate per-item formats, and the combined file. Resolves once the
// file is written (or failed), so callers get backpressure.
export async function downloadData(folder: string, filename: string, content: string, mime: string): Promise<void> {
  await downloadThrottled({
    url: `data:${mime};charset=utf-8,` + encodeURIComponent(content),
    filename: sanitizeFilePath(`${folder}/${filename}`),
    saveAs: false,
  });
}

// Download one post's files into the run folder. Resolves once all of them
// are written (or failed), so callers get backpressure.
export async function writeFiles(folder: string, files: OutFile[]): Promise<void> {
  await Promise.all(
    files.map((f) => {
      if ('content' in f) return downloadData(folder, f.path, f.content, f.mime);
      if (!isAllowedImageUrl(f.url)) return undefined;
      return downloadThrottled({ url: f.url, filename: sanitizeFilePath(`${folder}/${f.path}`), saveAs: false });
    })
  );
}

// Zip sink: every per-item file in one archive — a single download instead of
// one shelf entry per post. data.json and the combined file stay separate
// (they're one download each already). Only text files go in: a zip plan never
// saves media locally (planBatch), since image and video bytes can't be
// fetched into the archive.
export async function downloadZipArchive(folder: string, files: OutFile[]): Promise<void> {
  const entries: ZipEntry[] = files.flatMap((f) => ('content' in f ? [{ name: f.path, content: f.content }] : []));
  if (entries.length === 0) return;
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` + String(d.getDate()).padStart(2, '0');
  await downloadThrottled({
    url: zipDataUrl(buildZip(entries, d)),
    filename: sanitizeFilePath(`${folder}/x-files-${stamp}.zip`),
    saveAs: false,
  });
}

// JSON sink (ADR 0002 #11): one data.json per job with metadata, failures, and
// every successful item's AST. Written for cancelled jobs too — partial is
// honest since the matching files are already on disk.
export async function writeJsonManifest(folder: string, meta: JobMeta, items: StoredItem[]): Promise<void> {
  const manifest = {
    generator: 'xclipper-batch',
    jobId: meta.jobId,
    exportedAt: new Date().toISOString(),
    status: meta.status,
    completed: meta.completed,
    failures: meta.failures,
    items,
  };
  await downloadThrottled({
    url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest, null, 2)),
    filename: sanitizeFilePath(`${folder}/data.json`),
    saveAs: false,
  });
}

// Combined sink: one file for the whole batch in the chosen format —
// x-compilation-<date>.<ext>. Written when output is 'both'/'combined' (and
// always for CSV, which has no per-item form).
export async function writeCombined(folder: string, plan: BatchPlan, docs: Document[]): Promise<void> {
  const built = buildCombined(plan.format, docs, plan.formatOptions);
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` + String(d.getDate()).padStart(2, '0');
  await downloadData(folder, `x-compilation-${stamp}.${built.ext}`, built.content, built.mime);
}
