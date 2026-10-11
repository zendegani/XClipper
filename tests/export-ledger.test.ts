import { describe, it, expect, beforeEach } from 'vitest';
import {
  DATE_CURSOR_KEY,
  EXPORTED_LEDGER_KEY,
  INCOMPLETE_CAP,
  INCOMPLETE_LEDGER_KEY,
  LEDGER_CAP,
  RESUME_CURSOR_KEY,
  appendToLedger,
  loadDateCursors,
  loadExported,
  loadIncomplete,
  loadResumeCursors,
  recordExported,
  resetHistory,
  saveDateCursors,
  saveLedgers,
  saveResumeCursors,
} from '../src/shared/export-ledger';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  const chromeGlobal = (globalThis as unknown as { chrome: Record<string, Record<string, unknown>> }).chrome;
  chromeGlobal.storage.local = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(store, items),
    remove: async (keys: string[]) => keys.forEach((k) => delete store[k]),
  };
});

describe('appendToLedger', () => {
  it('appends new ids and skips duplicates', () => {
    const one = appendToLedger([], '1');
    expect(one).toEqual(['1']);
    expect(appendToLedger(one, '1')).toBe(one);
    expect(appendToLedger(one, '2')).toEqual(['1', '2']);
  });

  it('drops the oldest entries past the cap', () => {
    const full = Array.from({ length: LEDGER_CAP }, (_, i) => String(i));
    const next = appendToLedger(full, 'newest');
    expect(next).toHaveLength(LEDGER_CAP);
    expect(next[0]).toBe('1');
    expect(next[next.length - 1]).toBe('newest');
  });
});

describe('loadExported / loadIncomplete', () => {
  it('returns an empty list when nothing is stored', async () => {
    expect(await loadExported()).toEqual([]);
    expect(await loadIncomplete()).toEqual([]);
  });

  it('drops values that are not strings', async () => {
    store[EXPORTED_LEDGER_KEY] = ['1', 2, null, '3'];
    store[INCOMPLETE_LEDGER_KEY] = [4, '5'];
    expect(await loadExported()).toEqual(['1', '3']);
    expect(await loadIncomplete()).toEqual(['5']);
  });

  it('ignores a stored value that is not a list', async () => {
    store[EXPORTED_LEDGER_KEY] = { 1: true };
    expect(await loadExported()).toEqual([]);
  });
});

describe('recordExported', () => {
  it('adds the id once, after the ids already stored', async () => {
    store[EXPORTED_LEDGER_KEY] = ['1'];
    await recordExported('2');
    await recordExported('2');
    expect(store[EXPORTED_LEDGER_KEY]).toEqual(['1', '2']);
  });
});

describe('saveLedgers', () => {
  it('writes both lists', async () => {
    await saveLedgers(['1', '2'], ['3']);
    expect(store[EXPORTED_LEDGER_KEY]).toEqual(['1', '2']);
    expect(store[INCOMPLETE_LEDGER_KEY]).toEqual(['3']);
  });

  it('keeps only the newest ids of each list', async () => {
    const exported = Array.from({ length: LEDGER_CAP + 1 }, (_, i) => String(i));
    const incomplete = Array.from({ length: INCOMPLETE_CAP + 1 }, (_, i) => String(i));
    await saveLedgers(exported, incomplete);
    expect(store[EXPORTED_LEDGER_KEY]).toEqual(exported.slice(1));
    expect(store[INCOMPLETE_LEDGER_KEY]).toEqual(incomplete.slice(1));
  });
});

describe('loadResumeCursors / saveResumeCursors', () => {
  it('returns no cursors when nothing is stored', async () => {
    expect(await loadResumeCursors()).toEqual({});
  });

  it('reads back the cursors it saved', async () => {
    await saveResumeCursors({ bookmarks: 'c1', likes: 'c2' });
    expect(await loadResumeCursors()).toEqual({ bookmarks: 'c1', likes: 'c2' });
  });

  it('drops resume cursors that are not strings', async () => {
    store[RESUME_CURSOR_KEY] = { bookmarks: 'c1', likes: 2, profile: null };
    expect(await loadResumeCursors()).toEqual({ bookmarks: 'c1' });
  });

  it('ignores a stored value that is not an object', async () => {
    store[RESUME_CURSOR_KEY] = ['c1'];
    expect(await loadResumeCursors()).toEqual({});
  });
});

describe('loadDateCursors / saveDateCursors', () => {
  const scan = { cursor: 'c1', from: '2026-01-01', to: '2026-02-01' };

  it('returns no cursors when nothing is stored', async () => {
    expect(await loadDateCursors()).toEqual({});
  });

  it('reads back the cursors it saved', async () => {
    await saveDateCursors({ bookmarks: scan });
    expect(await loadDateCursors()).toEqual({ bookmarks: scan });
  });

  it('drops date cursors with the wrong shape', async () => {
    store[DATE_CURSOR_KEY] = {
      bookmarks: scan,
      likes: 'c2',
      profile: { cursor: 'c3', from: 1, to: '' },
    };
    expect(await loadDateCursors()).toEqual({ bookmarks: scan });
  });

  it('ignores a stored value that is not an object', async () => {
    store[DATE_CURSOR_KEY] = [scan];
    expect(await loadDateCursors()).toEqual({});
  });
});

describe('resetHistory', () => {
  it('removes the ledgers and both Fast Batch cursors', async () => {
    store = {
      [EXPORTED_LEDGER_KEY]: ['1'],
      [INCOMPLETE_LEDGER_KEY]: ['2'],
      [RESUME_CURSOR_KEY]: { bookmarks: 'c' },
      [DATE_CURSOR_KEY]: { bookmarks: { cursor: 'c', from: '', to: '' } },
      other: 'kept',
    };
    await resetHistory();
    expect(store).toEqual({ other: 'kept' });
  });
});
