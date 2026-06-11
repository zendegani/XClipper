import type { MediaItem } from '../../ast/types';
import { SELECTORS } from '../dom';
import { hostMatches } from '../../shared/media';

// Video thumbnail hosts on pbs.twimg.com. A thumb img with one of these path
// segments is a video (or GIF) whose <video> player hasn't mounted yet —
// without this check, an un-hydrated video is misclassified as an image.
const VIDEO_THUMB_RE = /\/(amplify_video_thumb|tweet_video_thumb|ext_tw_video_thumb)\//;

// Rewrite a thumb img src (…/HE6Z?format=jpg&name=large) into the same form a
// <video poster> attribute carries (…/HE6Z.jpg), so hydrated and un-hydrated
// extractions of the same video produce identical URLs.
function canonicalVideoThumbUrl(src: string): string {
  try {
    const u = new URL(src);
    const format = u.searchParams.get('format');
    if (format && !/\.[a-z0-9]+$/i.test(u.pathname)) {
      return `${u.origin}${u.pathname}.${format}`;
    }
    return src;
  } catch {
    return src;
  }
}

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
    if (VIDEO_THUMB_RE.test(src)) {
      const url = canonicalVideoThumbUrl(src);
      // The canonical form may match a poster we already emitted above.
      if (!videoPosters.has(url)) {
        out.push({ kind: 'video', url, posterUrl: url });
      }
      continue;
    }
    if (hostMatches(src, 'pbs.twimg.com')) {
      src = src.replace(/&name=\w+/, '&name=large');
    }
    const alt = img.getAttribute('alt') || undefined;
    out.push({ kind: 'image', url: src, ...(alt ? { alt } : {}) });
  }

  return out;
}
