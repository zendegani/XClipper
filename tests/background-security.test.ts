import { describe, expect, it } from 'vitest';
import {
  isAllowedImageUrl,
  isTrustedDownloadSender,
  isTrustedXContentSender,
  sanitizeFilePath,
} from '../src/background/security';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

function sender(fields: Partial<chrome.runtime.MessageSender>): chrome.runtime.MessageSender {
  return fields as chrome.runtime.MessageSender;
}

describe('isTrustedXContentSender()', () => {
  it('accepts HTTPS x.com content-script senders', () => {
    expect(
      isTrustedXContentSender(
        sender({
          id: EXTENSION_ID,
          url: 'https://x.com/example/status/123',
          origin: 'https://x.com',
          tab: { url: 'https://x.com/example/status/123' } as chrome.tabs.Tab,
        })
      )
    ).toBe(true);
  });

  it('rejects non-HTTPS x.com senders', () => {
    expect(
      isTrustedXContentSender(
        sender({
          id: EXTENSION_ID,
          url: 'http://x.com/example/status/123',
          origin: 'http://x.com',
        })
      )
    ).toBe(false);
  });

  it('rejects twitter.com for this x.com-scoped PR', () => {
    expect(
      isTrustedXContentSender(
        sender({
          id: EXTENSION_ID,
          url: 'https://twitter.com/example/status/123',
          origin: 'https://twitter.com',
        })
      )
    ).toBe(false);
  });

  it('rejects unrelated and malformed sender URLs', () => {
    expect(
      isTrustedXContentSender(
        sender({
          id: EXTENSION_ID,
          url: 'https://example.com/page',
          origin: 'https://example.com',
        })
      )
    ).toBe(false);

    expect(
      isTrustedXContentSender(
        sender({
          id: EXTENSION_ID,
          url: 'not a url',
        })
      )
    ).toBe(false);
  });

  it('uses sender origin when the sender URL is ambiguous', () => {
    expect(
      isTrustedXContentSender(
        sender({
          id: EXTENSION_ID,
          url: 'about:blank',
          origin: 'https://x.com',
        })
      )
    ).toBe(true);
  });
});

describe('isTrustedDownloadSender()', () => {
  it('accepts trusted X content-script senders', () => {
    expect(
      isTrustedDownloadSender(
        sender({
          id: EXTENSION_ID,
          url: 'https://x.com/example/status/123',
          origin: 'https://x.com',
        }),
        EXTENSION_ID
      )
    ).toBe(true);
  });

  it('accepts trusted extension-page senders', () => {
    expect(
      isTrustedDownloadSender(
        sender({
          id: EXTENSION_ID,
          url: `chrome-extension://${EXTENSION_ID}/popup.html`,
          origin: `chrome-extension://${EXTENSION_ID}`,
        }),
        EXTENSION_ID
      )
    ).toBe(true);
  });

  it('rejects same-extension content-script senders on unrelated pages', () => {
    expect(
      isTrustedDownloadSender(
        sender({
          id: EXTENSION_ID,
          url: 'https://example.com/page',
          origin: 'https://example.com',
          tab: { url: 'https://example.com/page' } as chrome.tabs.Tab,
        }),
        EXTENSION_ID
      )
    ).toBe(false);
  });

  it('rejects other extension IDs and missing sender identity', () => {
    expect(
      isTrustedDownloadSender(
        sender({
          id: 'otherextensionidotherextensionid',
          url: 'chrome-extension://otherextensionidotherextensionid/popup.html',
          origin: 'chrome-extension://otherextensionidotherextensionid',
        }),
        EXTENSION_ID
      )
    ).toBe(false);

    expect(isTrustedDownloadSender(sender({}), EXTENSION_ID)).toBe(false);
  });
});

describe('isAllowedImageUrl()', () => {
  it.each([
    'https://pbs.twimg.com/media/example.jpg',
    'https://video.twimg.com/ext_tw_video/123/pu/vid/720x720/video.mp4',
    'https://abs.twimg.com/hashflags/example.png',
    'https://abs-0.twimg.com/emoji/v2/svg/1f600.svg',
  ])('accepts allowed media URL %s', (url) => {
    expect(isAllowedImageUrl(url)).toBe(true);
  });

  it.each([
    'http://pbs.twimg.com/media/example.jpg',
    'https://example.com/image.jpg',
    'https://pbs.twimg.com.example.com/image.jpg',
    'not a url',
  ])('rejects disallowed media URL %s', (url) => {
    expect(isAllowedImageUrl(url)).toBe(false);
  });
});

describe('sanitizeFilePath()', () => {
  it.each([
    ['../../evil.md', 'evil.md'],
    ['/absolute/path.md', 'absolute/path.md'],
    ['folder/../../evil.md', 'folder/evil.md'],
    ['folder//image.jpg', 'folder/image.jpg'],
    ['tweet title with spaces.md', 'tweet-title-with-spaces.md'],
    ['bad\u0000name.md', 'bad_name.md'],
    ['../..', 'tweet2md.md'],
  ])('sanitizes %s to %s', (input, expected) => {
    expect(sanitizeFilePath(input)).toBe(expected);
  });

  it('limits individual path segments to 80 characters', () => {
    const result = sanitizeFilePath(`${'a'.repeat(120)}.jpg`);
    expect(result).toHaveLength(80);
  });

  it('limits the total path to 200 characters and preserves the final extension when feasible', () => {
    const input = Array.from(
      { length: 8 },
      (_, i) => `folder-${i}-${'a'.repeat(30)}`
    ).join('/') + '/final.md';
    const result = sanitizeFilePath(input);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('.md')).toBe(true);
  });
});
