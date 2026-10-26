import { describe, expect, it } from 'vitest';
import { buildObsidianUrl } from '../src/shared/obsidian';

describe('buildObsidianUrl()', () => {
  it('percent-encodes spaces (never uses + form-encoding)', () => {
    const url = buildObsidianUrl('my note.md', 'My Vault');
    expect(url).toContain('vault=My%20Vault');
    expect(url).toContain('file=my%20note');
    expect(url).not.toContain('+');
  });

  // The note body goes through the clipboard, never the URL (issue #181).
  it('asks Obsidian to read the note from the clipboard', () => {
    expect(buildObsidianUrl('note.md', 'My Vault')).toBe('obsidian://new?vault=My%20Vault&file=note&clipboard');
  });

  it('omits the vault parameter when blank', () => {
    const url = buildObsidianUrl('a.md', '');
    expect(url).not.toContain('vault=');
    expect(url.startsWith('obsidian://new?file=')).toBe(true);
  });

  it('strips the .md extension from the filename', () => {
    const url = buildObsidianUrl('elonmusk-123.md', '');
    expect(url).toContain('file=elonmusk-123');
    expect(url).not.toContain('file=elonmusk-123.md');
  });

  it('encodes characters that would otherwise break the URL', () => {
    const url = buildObsidianUrl('a & b = c.md', '');
    expect(url).toContain('file=a%20%26%20b%20%3D%20c&');
  });

  it('prepends a vault subfolder to the file path', () => {
    const url = buildObsidianUrl('note.md', '', 'Tweets');
    expect(url).toContain('file=Tweets%2Fnote');
  });

  it('supports nested subfolders', () => {
    const url = buildObsidianUrl('note.md', '', 'Inbox/Tweets');
    expect(url).toContain('file=Inbox%2FTweets%2Fnote');
  });

  it('strips leading/trailing slashes and collapses doubles in the subfolder', () => {
    const url = buildObsidianUrl('note.md', '', '//Inbox//Tweets//');
    expect(url).toContain('file=Inbox%2FTweets%2Fnote');
  });

  it('blocks .. traversal segments in the subfolder', () => {
    const url = buildObsidianUrl('note.md', '', '../../etc/Tweets');
    expect(url).toContain('file=etc%2FTweets%2Fnote');
  });

  it('omits the subfolder when blank or unusable', () => {
    expect(buildObsidianUrl('note.md', '', '')).toContain('file=note');
    expect(buildObsidianUrl('note.md', '', '   ')).toContain('file=note');
    expect(buildObsidianUrl('note.md', '', '..')).toContain('file=note');
  });
});
