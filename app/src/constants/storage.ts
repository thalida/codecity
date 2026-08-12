// constants/storage.ts — localStorage keys, centralised so a typo can't split
// state across two slots. Every key shares the `cc.` prefix, so one grep finds
// everything codecity owns.

export const STORAGE_PREFIX = 'cc.';

/** Bare suffixes: persistedSignal() prepends STORAGE_PREFIX, so `recents` lands
 *  in `cc.recents`. Every persisted key is here; there is no second table. */
export const PERSISTED_KEYS = {
  /** The `.v2` bump drops pre-v2 entries, which carried a `branch` a local
   *  source no longer has: cheaper than migrating an MRU convenience list. */
  RECENTS: 'recents.v2',
  /** Per-repo UI exclude lists (repo key -> rel-paths hidden from the city). */
  EXCLUDES: 'excludes',
} as const;
