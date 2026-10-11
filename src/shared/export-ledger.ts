// The export ledger: which posts past batch runs already exported, persisted in
// chrome.storage.local. Both batch engines read and write it, and the popup
// reads it for the "(N new)" count — so the ledger's stored format lives here
// once. It also names every key Reset history clears; Fast Batch still reads
// and writes the two cursors itself. No chrome.* at import time, so the popup
// can import it.

// Status ids already exported. Batch runs skip these so re-running on a longer
// scroll of the same bookmarks doesn't duplicate files.
export const EXPORTED_LEDGER_KEY = 'xclipper_batch_exported';
export const LEDGER_CAP = 5000;

// Fast Batch only: ids written as partial (rate-limited) stubs — un-ledgered so
// a re-run retries them, and expanded FIRST next run so a stable feed order
// can't starve the same tail forever (issue #81).
export const INCOMPLETE_LEDGER_KEY = 'xclipper_fast_incomplete';
// It drains as items complete, so this only guards against a pathological run
// of rate limits growing it unbounded.
export const INCOMPLETE_CAP = 2000;

// Fast Batch only: per-source cursor for Resume pagination — where the last
// Resume run left off, so the next continues instead of re-scanning the feed
// from the top (issue #83). Shape { [source]: cursor }. Cleared by Reset history.
export const RESUME_CURSOR_KEY = 'xclipper_fast_resume';

// Fast Batch only: Date-range mode's OWN continuation cursor, kept separate from
// RESUME_CURSOR_KEY so a date-range crawl never disturbs a Resume backfill's
// position (issue #83). Scoped to the window it was scanning ({cursor,from,to});
// a different window starts over. Shape { [source]: {cursor,from,to} }.
export const DATE_CURSOR_KEY = 'xclipper_fast_date';

export function appendToLedger(ledger: string[], id: string): string[] {
  if (ledger.includes(id)) return ledger;
  const next = [...ledger, id];
  return next.length > LEDGER_CAP ? next.slice(next.length - LEDGER_CAP) : next;
}

async function loadIds(key: string): Promise<string[]> {
  const raw = (await chrome.storage.local.get(key))[key];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function loadExported(): Promise<string[]> {
  return loadIds(EXPORTED_LEDGER_KEY);
}

export function loadIncomplete(): Promise<string[]> {
  return loadIds(INCOMPLETE_LEDGER_KEY);
}

// Manual batch: one post at a time, so read-append-write per post.
export async function recordExported(id: string): Promise<void> {
  await chrome.storage.local.set({ [EXPORTED_LEDGER_KEY]: appendToLedger(await loadExported(), id) });
}

// Fast Batch: holds both lists in memory for the run and saves them whole.
export async function saveLedgers(exported: string[], incomplete: string[]): Promise<void> {
  await chrome.storage.local.set({
    [EXPORTED_LEDGER_KEY]: exported.slice(-LEDGER_CAP),
    [INCOMPLETE_LEDGER_KEY]: incomplete.slice(-INCOMPLETE_CAP),
  });
}

// Keyed by Fast Batch source ('bookmarks' | 'profile' | 'likes'). The keys stay
// plain strings so this shared module needs nothing from src/background/.
export type ResumeCursors = Partial<Record<string, string>>;
type DateCursor = { cursor: string; from: string; to: string };
export type DateCursors = Partial<Record<string, DateCursor>>;

// Storage holds whatever an older build or a manual edit left there, so keep
// only the entries with the right shape, as loadIds does for the ledgers.
async function loadCursors<T>(key: string, keep: (v: unknown) => v is T): Promise<Record<string, T>> {
  const raw = (await chrome.storage.local.get(key))[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, T] => keep(e[1])));
}

const isString = (v: unknown): v is string => typeof v === 'string';

const isDateCursor = (v: unknown): v is DateCursor =>
  !!v &&
  typeof v === 'object' &&
  isString((v as DateCursor).cursor) &&
  isString((v as DateCursor).from) &&
  isString((v as DateCursor).to);

export function loadResumeCursors(): Promise<ResumeCursors> {
  return loadCursors(RESUME_CURSOR_KEY, isString);
}

export async function saveResumeCursors(cursors: ResumeCursors): Promise<void> {
  await chrome.storage.local.set({ [RESUME_CURSOR_KEY]: cursors });
}

export function loadDateCursors(): Promise<DateCursors> {
  return loadCursors(DATE_CURSOR_KEY, isDateCursor);
}

export async function saveDateCursors(cursors: DateCursors): Promise<void> {
  await chrome.storage.local.set({ [DATE_CURSOR_KEY]: cursors });
}

export async function resetHistory(): Promise<void> {
  await chrome.storage.local.remove([
    EXPORTED_LEDGER_KEY,
    INCOMPLETE_LEDGER_KEY,
    RESUME_CURSOR_KEY,
    DATE_CURSOR_KEY,
  ]);
}
