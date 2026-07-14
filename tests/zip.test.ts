import { describe, expect, it } from 'vitest';
import { buildZip, zipDataUrl } from '../src/background/zip';

// Walk the archive's local file headers and read every entry back — a tiny
// structural reader, enough to prove the container is well-formed without a
// zip dependency.
function readEntries(bytes: Uint8Array): { name: string; content: string; crc: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: { name: string; content: string; crc: number }[] = [];
  let pos = 0;
  while (view.getUint32(pos, true) === 0x04034b50) {
    const crc = view.getUint32(pos + 14, true);
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const start = pos + 30 + nameLen + extraLen;
    entries.push({ name, content: decoder.decode(bytes.subarray(start, start + size)), crc });
    pos = start + size;
  }
  return entries;
}

describe('buildZip', () => {
  it('round-trips entries, including subfolders and non-ASCII names', () => {
    const zip = buildZip([
      { name: 'a.md', content: 'hello' },
      { name: '_incomplete_rerun_to_complete/ünïcodé-名前.md', content: '# Ünïcode content 🎉' },
    ]);
    expect(readEntries(zip)).toEqual([
      // CRC-32 of "hello" is the well-known 0x3610a686.
      { name: 'a.md', content: 'hello', crc: 0x3610a686 },
      {
        name: '_incomplete_rerun_to_complete/ünïcodé-名前.md',
        content: '# Ünïcode content 🎉',
        crc: expect.any(Number),
      },
    ]);
  });

  it('writes a consistent central directory and end record', () => {
    const entries = [
      { name: 'one.txt', content: 'first' },
      { name: 'two.txt', content: 'second' },
    ];
    const zip = buildZip(entries);
    const view = new DataView(zip.buffer);
    // End-of-central-directory record sits in the last 22 bytes (no comment).
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 8, true)).toBe(2); // entries on disk
    expect(view.getUint16(eocd + 10, true)).toBe(2); // entries total
    const centralOffset = view.getUint32(eocd + 16, true);
    const centralSize = view.getUint32(eocd + 12, true);
    expect(centralOffset + centralSize).toBe(eocd);
    // First central header points back at the first local header (offset 0).
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(view.getUint32(centralOffset + 42, true)).toBe(0);
  });

  it('produces an empty-but-valid archive for zero entries', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});

describe('zipDataUrl', () => {
  it('base64-encodes the bytes with the zip mime', () => {
    const url = zipDataUrl(new Uint8Array([80, 75, 3, 4]));
    expect(url).toBe('data:application/zip;base64,' + Buffer.from([80, 75, 3, 4]).toString('base64'));
  });
});
