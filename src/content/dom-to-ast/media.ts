import type { MediaItem } from '../../ast/types';
import { SELECTORS } from '../dom';
import { hostMatches } from '../../shared/media';

export function extractMedia(scope: Element, excludeContainers: Element[]): MediaItem[] {
  const inExcluded = (el: Element) =>
    excludeContainers.some((c) => c.contains(el));

  const out: MediaItem[] = [];

  const videos = Array.from(scope.querySelectorAll('video')).filter(
    (v) => !inExcluded(v)
  );
  for (const video of videos) {
    const poster = video.getAttribute('poster');
    if (!poster) continue;
    out.push({ kind: 'video', url: poster, posterUrl: poster });
  }

  const videoPosters = new Set(
    videos.map((v) => v.getAttribute('poster')).filter((p): p is string => !!p)
  );
  const photoImgs = Array.from(scope.querySelectorAll(`${SELECTORS.tweetPhoto} img`))
    .filter((img) => !inExcluded(img));
  for (const img of photoImgs) {
    let src = (img as HTMLImageElement).src;
    if (!src) continue;
    if (src.includes('emoji') || src.includes('profile_images')) continue;
    if (videoPosters.has(src)) continue;
    if (hostMatches(src, 'pbs.twimg.com')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }
    const alt = img.getAttribute('alt') || undefined;
    out.push({ kind: 'image', url: src, ...(alt ? { alt } : {}) });
  }

  return out;
}
