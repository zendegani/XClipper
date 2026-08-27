import type { DownloadAiZipRequest } from '../types/messages';
import { isAllowedImageUrl } from './security';
import type { ZipEntry } from './zip';

export type ImageByteLoader = (url: string) => Promise<Uint8Array>;

export function aiZipFilename(markdownFilename: string): string {
  return markdownFilename.replace(/\.md$/i, '') + '.zip';
}

export function normalizeZipEntryName(name: string): string | null {
  const normalized = String(name ?? '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/[\x00-\x1f]/g, '_')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');

  return normalized || null;
}

export async function buildAiZipEntries(
  message: DownloadAiZipRequest,
  loadImageBytes: ImageByteLoader
): Promise<ZipEntry[]> {
  const markdownName = normalizeZipEntryName(message.filename) || 'xclipper.md';
  const entries: ZipEntry[] = [{ name: markdownName, content: message.content }];
  const usedNames = new Set(entries.map((entry) => entry.name));

  for (const img of message.images ?? []) {
    if (!img || typeof img.url !== 'string' || typeof img.filename !== 'string') continue;
    if (!isAllowedImageUrl(img.url)) continue;

    const entryName = normalizeZipEntryName(img.filename);
    if (!entryName || usedNames.has(entryName)) continue;

    entries.push({ name: entryName, content: await loadImageBytes(img.url) });
    usedNames.add(entryName);
  }

  return entries;
}
