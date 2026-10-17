import { describe, expect, it } from 'vitest';
import {
  isAllowedImageUrl,
  isExtensionPageSender,
  isTrustedXContentSender,
  sanitizeFilePath,
} from '../src/background/security';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const CHROME_BASE = `chrome-extension://${EXTENSION_ID}/`;

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

describe('isExtensionPageSender()', () => {
  it('accepts pages of this extension', () => {
    expect(
      isExtensionPageSender(
        sender({
          id: EXTENSION_ID,
          url: `chrome-extension://${EXTENSION_ID}/popup.html`,
          origin: `chrome-extension://${EXTENSION_ID}`,
        }),
        EXTENSION_ID,
        CHROME_BASE
      )
    ).toBe(true);
  });

  it('rejects this extension\'s content script on x.com', () => {
    expect(
      isExtensionPageSender(
        sender({
          id: EXTENSION_ID,
          url: 'https://x.com/example/status/123',
          origin: 'https://x.com',
        }),
        EXTENSION_ID,
        CHROME_BASE
      )
    ).toBe(false);
  });

  it('rejects other extension IDs and missing sender identity', () => {
    expect(
      isExtensionPageSender(
        sender({
          id: 'otherextensionidotherextensionid',
          url: 'chrome-extension://otherextensionidotherextensionid/popup.html',
          origin: 'chrome-extension://otherextensionidotherextensionid',
        }),
        EXTENSION_ID,
        CHROME_BASE
      )
    ).toBe(false);

    expect(isExtensionPageSender(sender({}), EXTENSION_ID, CHROME_BASE)).toBe(false);
  });

  // Firefox: the ID is the gecko ID, but pages live under a per-install UUID.
  const GECKO_ID = 'xclipper@zendegani.github.io';
  const FIREFOX_BASE = 'moz-extension://0b9e3c52-6a1d-4f3e-9c2a-5d7e8f9a1b2c/';

  it('accepts pages of this extension in Firefox', () => {
    expect(
      isExtensionPageSender(
        sender({ id: GECKO_ID, url: `${FIREFOX_BASE}popup.html` }),
        GECKO_ID,
        FIREFOX_BASE
      )
    ).toBe(true);
  });

  it('rejects another Firefox extension page', () => {
    expect(
      isExtensionPageSender(
        sender({ id: GECKO_ID, url: 'moz-extension://11111111-2222-3333-4444-555555555555/popup.html' }),
        GECKO_ID,
        FIREFOX_BASE
      )
    ).toBe(false);
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
    ['../..', 'xclipper.md'],
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
