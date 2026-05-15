import { describe, expect, it } from 'vitest';
import { buildObsidianUrl } from '../src/shared/obsidian';

describe('buildObsidianUrl()', () => {
  it('percent-encodes spaces (never uses + form-encoding)', () => {
    const url = buildObsidianUrl('hello world', 'my note.md', 'My Vault');
    expect(url).toContain('vault=My%20Vault');
    expect(url).toContain('file=my%20note');
    expect(url).toContain('content=hello%20world');
    expect(url).not.toContain('+');
  });

  it('omits the vault parameter when blank', () => {
    const url = buildObsidianUrl('x', 'a.md', '');
    expect(url).not.toContain('vault=');
    expect(url.startsWith('obsidian://new?file=')).toBe(true);
  });

  it('strips the .md extension from the filename', () => {
    const url = buildObsidianUrl('x', 'elonmusk-123.md', '');
    expect(url).toContain('file=elonmusk-123');
    expect(url).not.toContain('file=elonmusk-123.md');
  });

  it('encodes characters that would otherwise break the URL', () => {
    const url = buildObsidianUrl('a & b = c', 'f.md', '');
    expect(url).toContain('content=a%20%26%20b%20%3D%20c');
  });
});
