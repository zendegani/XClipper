// Resolve a single post's video URLs so they can be saved locally.
//
// The DOM extractor can't see them (ADR 0003 — X plays video through MSE, so
// only X's own GraphQL payload carries the MP4 variant list). Fast Batch already
// captures the session's auth for exactly this, so single export borrows that
// same machinery for one TweetDetail call instead of growing a second one.
//
// Everything here is best-effort by design: no auth captured yet, no
// TweetDetail template observed, a rate limit, a deleted post — every one of
// them returns an empty map, the video stays a remote link, and the rest of the
// export is untouched.

import { collectMedia, isDownloadableVideo } from '../ast/collect-media';
import { posterKey } from '../ast/apply-video-urls';
import { tweetDetailToDocument } from '../graphql/tweet-detail';
import { getVariables, setVariablesParam } from '../graphql/timeline';
import { authedFetchJson, hasAccess, restoreSession, templates } from './x-session';

const log = (...args: unknown[]): void => console.log('[xclipper single-video]', ...args);

// poster path → MP4 URL, ready for applyVideoUrls.
export async function resolveVideoUrls(tweetId: string): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  if (!/^\d+$/.test(tweetId)) return empty;

  await restoreSession();
  if (!(await hasAccess())) {
    log('no webRequest permission — pick Media in Export settings to grant it');
    return empty;
  }

  const template = templates.TweetDetail;
  if (!template) {
    log('no TweetDetail request observed yet — reload the post once, then retry');
    return empty;
  }

  try {
    const vars = JSON.parse(getVariables(template)) as Record<string, unknown>;
    vars.focalTweetId = tweetId;
    delete vars.cursor;
    const json = await authedFetchJson(setVariablesParam(template, JSON.stringify(vars)));
    const doc = tweetDetailToDocument(json);

    const map = new Map<string, string>();
    for (const media of collectMedia(doc)) {
      if (!isDownloadableVideo(media)) continue;
      const key = media.posterUrl ? posterKey(media.posterUrl) : null;
      if (key) map.set(key, media.url);
    }
    log(`resolved ${map.size} video(s) for ${tweetId}`, [...map.keys()]);
    return map;
  } catch (err) {
    log('video resolution failed, keeping remote links:', err);
    return empty;
  }
}
