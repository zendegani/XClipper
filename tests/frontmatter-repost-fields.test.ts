import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The two repost fields stay in the picker. Include reposts off greys them.
// Include reposts on lets each one switch.

function repostBoxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('[data-field="reposted_by"], [data-field="reposted_at"]')];
}

describe('repost frontmatter fields', () => {
  beforeEach(() => {
    vi.resetModules();
    const html = readFileSync(resolve(__dirname, '../src/popup/popup.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const chromeGlobal = (globalThis as unknown as { chrome: Record<string, Record<string, unknown>> }).chrome;
    chromeGlobal.permissions = {
      contains: (_p: unknown, cb: (has: boolean) => void) => cb(false),
      request: (_p: unknown, cb: (granted: boolean) => void) => cb(false),
    };
  });

  it('stays grey until Include reposts is on, then each field can switch', async () => {
    const { initSettingsForm } = await import('../src/popup/settings-form');
    initSettingsForm();
    await vi.waitFor(() => {
      const box = document.querySelector<HTMLInputElement>('[data-field="reposted_by"][data-mode="default"]');
      expect(box?.checked).toBe(true);
    });

    expect(repostBoxes()).toHaveLength(4);
    expect(repostBoxes().every((el) => el.disabled)).toBe(true);
    const author = document.querySelector<HTMLInputElement>('[data-field="author"][data-mode="default"]');
    expect(author?.disabled).toBe(false);

    const include = document.getElementById('chk-include-reposts') as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new Event('change'));
    expect(repostBoxes().every((el) => el.disabled)).toBe(false);

    const by = document.querySelector<HTMLInputElement>('[data-field="reposted_by"][data-mode="default"]')!;
    by.checked = false;
    by.dispatchEvent(new Event('change'));

    include.checked = false;
    include.dispatchEvent(new Event('change'));
    expect(by.disabled).toBe(true);
    expect(by.checked).toBe(false);
    const at = document.querySelector<HTMLInputElement>('[data-field="reposted_at"][data-mode="default"]')!;
    expect(at.checked).toBe(true);
    expect(at.disabled).toBe(true);
  });
});
