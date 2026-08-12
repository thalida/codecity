// constants/storage.ts — localStorage keys, centralised so a typo can't split
// state across two slots. Every key shares the `cc.` prefix, so one grep finds
// everything codecity owns.

export const STORAGE_PREFIX = 'cc.';

/** Bare keys for persistedSignal()-backed stores. These are BARE suffixes —
 *  persistedSignal() prepends STORAGE_PREFIX itself, so the effective slot is
 *  e.g. `cc.recents`. All persisted UI/session state flows through here; there
 *  is no separate raw-localStorage key table. */
export const PERSISTED_KEYS = {
  /** Recently-opened sources list (source-picker MRU). The `.v2` bump resets the
   *  slot once: pre-v2 local entries stored a `branch` (their checkout), which a
   *  local source no longer carries — dropping the stale slot is cheaper than
   *  migrating an MRU convenience list. */
  RECENTS: 'recents.v2',
  /** Per-repo UI exclude lists (repo key -> rel-paths hidden from the city). */
  EXCLUDES: 'excludes',
} as const;
