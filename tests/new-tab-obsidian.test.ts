import { expect, it, vi } from 'vitest';

// Right-clicking a post other than the open one, or using the button on a
// timeline, opens the post in a new tab with `#xclipper=obsidian`. The content
// script exports on load. That tab stays open, so it must say the note
// replaced the clipboard, as the in-place export does (issue #181).

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

document.body.innerHTML = `
  <article role="article">
    <div data-testid="User-Name">
      <a href="/alice"><span>Alice</span></a>
      <a href="/alice"><span>@alice</span></a>
    </div>
    <a href="/alice/status/222"><time datetime="2026-05-01T00:01:00.000Z">May 1</time></a>
    <div data-testid="tweetText"><span>A tweet</span></div>
  </article>
`;
const location = {
  ...window.location,
  pathname: '/alice/status/222',
  search: '',
  hash: '#xclipper=obsidian',
  href: 'https://x.com/alice/status/222#xclipper=obsidian',
};
Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });

await import('../src/content/content');

it('copies the note, opens Obsidian, and says the clipboard was used', async () => {
  await vi.waitFor(() => expect(location.href).toMatch(/^obsidian:\/\/new\?file=[^&]+&clipboard$/), {
    timeout: 5000,
  });
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('A tweet'));
  // tests/setup.ts makes chrome.i18n.getMessage return the key.
  await vi.waitFor(() =>
    expect([...document.body.children].map((el) => el.textContent)).toContain('obsidian_opened')
  );
});
