// Single-export "Zip files" packing: one post becomes one archive holding the
// Markdown and the media it references, instead of a loose file plus a sibling
// media folder the user has to keep together by hand.
//
// Entry names go through the same sanitizeFilePath the loose-file path uses, so
// a zipped export and an unzipped one lay out identically — the archive is a
// different container for the same result, not a different result.

import { isAllowedImageUrl, sanitizeFilePath } from './security';
import type { ZipEntry } from './zip';

// Resolves to null when the media can't be fetched, which is the whole point of
// the seam: a dead media URL must not cost the user their Markdown.
export type MediaByteLoader = (url: string) => Promise<Uint8Array | null>;

export function zipFilenameFor(markdownFilename: string): string {
  return markdownFilename.replace(/\.[^./]+$/, '') + '.zip';
}

export async function buildSingleZipEntries(
  content: string,
  filename: string,
  images: { url: string; filename: string }[] | undefined,
  loadBytes: MediaByteLoader
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [{ name: sanitizeFilePath(filename), content }];
  const taken = new Set(entries.map((e) => e.name));

  for (const img of images ?? []) {
    if (!img || typeof img.url !== 'string' || typeof img.filename !== 'string') continue;
    if (!isAllowedImageUrl(img.url)) continue;

    const name = sanitizeFilePath(img.filename);
    if (taken.has(name)) continue;

    const bytes = await loadBytes(img.url);
    if (!bytes) continue; // fetch failed — skip this one, keep the rest

    entries.push({ name, content: bytes });
    taken.add(name);
  }

  return entries;
}
