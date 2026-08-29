// Turn a post's videos into local files.
//
// X plays video through MSE, so a DOM-extracted node carries only its poster
// (ADR 0003) — the MP4 variant list lives in X's own GraphQL payload. Both DOM
// export paths need the same three steps around that fetch (is there anything
// unresolved / fill it in / say what to download), but they reach the fetch
// differently: the popup asks the background over a message, while the batch
// orchestrator IS the background and calls it directly. That channel is
// deliberately closed to content scripts — it replays the user's X session —
// so the resolver is a parameter rather than something this module picks.
//
// Failure is ordinary, not exceptional: no permission, no request template
// observed yet, a rate limit, a post X streams with no downloadable file. All
// of them land on 'unresolved', which leaves the export exactly as it was —
// the thumbnail, and the remote link.

import type { Document } from '../ast/types';
import { applyVideoUrls } from '../ast/apply-video-urls';
import { collectMedia, isDownloadableVideo } from '../ast/collect-media';

export interface VideoAttachment {
  renderedUrl: string;
  downloadUrl: string;
}

// [poster path, MP4 URL] pairs, as resolve-video.ts produces them.
export type Mp4Resolver = (tweetId: string) => Promise<[string, string][]>;

export type LocalVideoResult =
  | { status: 'none' }
  | { status: 'unresolved' }
  | { status: 'resolved'; attachments: VideoAttachment[] };

// Fills the MP4 URLs into `doc` in place. Callers re-render the Markdown from
// it with `includeVideoLinks` so the ▶ link points at the file being saved.
export async function resolveLocalVideo(
  doc: Document,
  tweetId: string,
  fetchMp4Urls: Mp4Resolver
): Promise<LocalVideoResult> {
  // A node still standing on its poster is a video we haven't resolved yet.
  // None here means nothing to fetch, so skip the round trip entirely.
  const unresolved = collectMedia(doc).filter(
    (m) => (m.kind === 'video' || m.kind === 'gif') && m.url === m.posterUrl
  );
  if (unresolved.length === 0) return { status: 'none' };

  const urls = await fetchMp4Urls(tweetId);
  const applied = urls.length ? applyVideoUrls(doc, new Map(urls)) : 0;
  if (applied === 0) return { status: 'unresolved' };

  return { status: 'resolved', attachments: videoAttachments(doc) };
}

// Structural: walk the AST for the MP4s rather than parsing the rendered
// Markdown back out. renderedUrl is what the renderer wrote into the
// [▶ Video] token; downloadUrl is what we fetch — the same today, kept
// separate because that is the seam a later phase would widen.
export function videoAttachments(doc: Document): VideoAttachment[] {
  return collectMedia(doc)
    .filter(isDownloadableVideo)
    .map((m) => ({ renderedUrl: m.url, downloadUrl: m.url }));
}
