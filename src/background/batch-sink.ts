// Shared batch sink + format helpers (ADR 0002 #11, generalized for ADR 0003).
//
// The AST is the source of truth: given a folder and the per-item Documents,
// these write the per-item files, the per-job data.json, and the one combined
// file in the chosen format. They are parameterized by `folder` (not by a
// BatchJob), so BOTH the DOM worker-tab batch (batch.ts) and the GraphQL Fast
// Batch (fast-batch.ts) reuse exactly the same writers — only acquisition
// differs.

import type { ExtractedContent } from '../types/messages';
import type { Document } from '../ast/types';
import { renderDigest } from '../ast/render-digest';
import { renderMarkdown } from '../ast/render-markdown';
import { renderPdfHtmlMany } from '../ast/render-pdf-html';
import type { BatchFormat, Settings } from '../shared/settings';
import {
  buildFormatExport,
  buildCsvTable,
  markdownToPlainText,
  type ExportFormat,
  type FormatOptions,
} from '../shared/export-formats';
import { postProcess } from '../shared/post-process';
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

// The job-level fields the data.json manifest records (decoupled from BatchJob).
export interface JobMeta {
  jobId: string;
  status: string;
  completed: number;
  failures: BatchFailure[];
}

export function formatOptionsFrom(s: Settings): FormatOptions {
  return {
    includeEngagement: s.inlineStats,
    obsidianFriendly: s.obsidianFriendly,
    frontmatterFields: s.obsidianFriendly ? s.frontmatterFieldsObsidian : s.frontmatterFields,
    obsidianTagsTemplate: s.obsidianTagsTemplate,
    includeMetadata: s.includeMetadata,
  };
}

// Reconstruct the ExtractedContent the format builders + postProcess expect from
// an AST. renderMarkdown gives the raw body Markdown (no frontmatter) used by the
// TXT and CSV-description paths — the same string single-export passes.
export function docToExtracted(doc: Document): ExtractedContent {
  const m = doc.metadata;
  return {
    type: m.type,
    author: { name: m.author.name, handle: m.author.handle },
    title: m.title,
    markdown: renderMarkdown(doc),
    sourceUrl: m.sourceUrl,
    date: m.date,
    tweetId: m.tweetId,
    metadata: m.engagement,
    body: doc,
  };
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
      return { content: buildCsvTable(docs.map(docToExtracted), opts), mime: 'text/csv', ext: 'csv' };
  }
}

// Download pacing: a big batch can fire thousands of downloads (a Super Fast
// run alone writes 1000s of files, plus images). Unthrottled, they all hit
// Chrome's browser process at once — data-URL decode, downloads-UI updates,
// history-DB inserts, disk writes — and the whole browser janks until the
// queue drains. A small in-flight cap lets disk/network set the pace while
// Chrome stays responsive. Failures resolve rather than reject — a batch never
// dies on one bad file, matching the old fire-and-forget behavior.
const MAX_INFLIGHT_DOWNLOADS = 8;
let inflight = 0;
const waiting: (() => void)[] = [];

function downloadThrottled(options: chrome.downloads.DownloadOptions): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      inflight--;
      resolve();
      waiting.shift()?.();
    };
    const start = (): void => {
      inflight++;
      chrome.downloads.download(options, (id) => {
        if (chrome.runtime.lastError || id === undefined) return finish();
        const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
          const state = delta.state?.current;
          if (delta.id === id && (state === 'complete' || state === 'interrupted')) {
            chrome.downloads.onChanged.removeListener(onChanged);
            finish();
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
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

// Folder sink (ADR 0002 #11): the item's Markdown plus any local images, all
// under the job's downloads subfolder. Image paths already embed the item's own
// media dir; Chrome uniquifies any residual conflict.
export async function downloadItem(
  folder: string,
  filename: string,
  markdown: string,
  images?: { url: string; filename: string }[]
): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const img of images ?? []) {
    if (!img || typeof img.url !== 'string' || !isAllowedImageUrl(img.url)) continue;
    writes.push(
      downloadThrottled({
        url: img.url,
        filename: sanitizeFilePath(`${folder}/${img.filename}`),
        saveAs: false,
      })
    );
  }
  writes.push(downloadData(folder, filename, markdown, 'text/markdown'));
  await Promise.all(writes);
}

// One item's file (name + content) in the chosen format — the piece of the
// per-item write that both sinks share: writePerItem downloads it, the zip
// sink packs it into the archive instead.
export function buildPerItemFile(
  format: BatchFormat,
  filename: string,
  markdown: string,
  doc: Document | undefined,
  settings: Settings
): { name: string; content: string; mime: string } {
  if (format === 'md' || !doc) return { name: filename, content: markdown, mime: 'text/markdown' };
  const built = buildFormatExport(format as ExportFormat, docToExtracted(doc), formatOptionsFrom(settings));
  return { name: filename.replace(/\.md$/i, '') + '.' + built.ext, content: built.content, mime: built.mime };
}

// Write one item's file in the chosen format. Markdown is the postProcessed
// output (+ local images); other formats are derived from the AST. Images only
// attach to Markdown. CSV never reaches this (it's always combined).
export async function writePerItem(
  folder: string,
  format: BatchFormat,
  filename: string,
  markdown: string,
  images: { url: string; filename: string }[] | undefined,
  doc: Document | undefined,
  settings: Settings
): Promise<void> {
  if (format === 'md' || !doc) {
    await downloadItem(folder, filename, markdown, images);
    return;
  }
  const file = buildPerItemFile(format, filename, markdown, doc, settings);
  await downloadData(folder, file.name, file.content, file.mime);
}

// Rebuild a stored item as a zip entry. Markdown is re-derived from the AST
// through the same postProcess pipeline the live write path uses (mirroring
// the content script's options); local images are always off in zip mode, so
// the remote-URL rendering is the correct one.
export function zipEntryFromStored(item: StoredItem, format: BatchFormat, settings: Settings): ZipEntry {
  const result = postProcess(docToExtracted(item.doc), {
    includeMetadata: settings.includeMetadata,
    downloadImages: false,
    inlineStats: settings.inlineStats,
    obsidianFriendly: settings.obsidianFriendly,
    filenameTemplate: settings.filenameTemplate.trim(),
    frontmatterFields: settings.obsidianFriendly ? settings.frontmatterFieldsObsidian : settings.frontmatterFields,
  });
  const file = buildPerItemFile(format, item.filename, result.markdown, item.doc, settings);
  return { name: file.name, content: file.content };
}

// Zip sink: every per-item file in one archive — a single download instead of
// one shelf entry per post. data.json and the combined file stay separate
// (they're one download each already).
export async function downloadZipArchive(folder: string, entries: ZipEntry[]): Promise<void> {
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
export async function writeCombined(
  folder: string,
  format: BatchFormat,
  docs: Document[],
  settings: Settings
): Promise<void> {
  const built = buildCombined(format, docs, formatOptionsFrom(settings));
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` + String(d.getDate()).padStart(2, '0');
  await downloadData(folder, `x-compilation-${stamp}.${built.ext}`, built.content, built.mime);
}
