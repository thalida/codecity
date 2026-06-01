// views/panes/controls/hooks.ts — Reactive bridge between widget components
// and the draft layer. Widgets render with the "effective" value (draft if
// pending, else committed) and re-render whenever EITHER source changes.
//
// Both reads are auto-tracked by Preact: store.value via the signal itself,
// and the draft layer via DRAFTS_REV which is bumped on every mutation in
// state/drafts.

import { getEffective, DRAFTS_REV } from '@/state/drafts';
import { getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

/** A (store, key) the reset machinery can act on — the structural shape of a
 *  controls FieldRef. */
export interface ResettableRef {
  store: SignalLike;
  key: string;
}

type DraftKey = string | null;

/**
 * Effective value for `store[key]` (or whole-signal when key === null).
 * Tracks both the store signal and DRAFTS_REV so the component re-renders
 * when either changes.
 */
export function useEffective<T = unknown>(store: SignalLike, key: DraftKey): T {
  void store.value;
  void DRAFTS_REV.value;
  return getEffective(store, key) as T;
}

/**
 * Registered default for `store[key]`. Static — doesn't need tracking,
 * but exposed as a hook so call sites read uniformly.
 */
export function useDefault<T = unknown>(store: SignalLike, key: DraftKey): T {
  return (key === null ? getDefault(store) : getDefault(store, key)) as T;
}

/**
 * True iff the effective value at `store[key]` differs from its registered
 * default. Reactive via useEffective.
 */
export function useDiffersFromDefault(store: SignalLike, key: DraftKey): boolean {
  const eff = useEffective(store, key);
  const def = useDefault(store, key);
  return !deepEqual(eff, def);
}

/**
 * True iff ANY of `keys` differs from its registered default. Used by
 * row-level reset buttons (one row may bind to a single key, or a pair
 * for range-pair widgets).
 */
export function useAnyDiffersFromDefault(store: SignalLike, keys: string[]): boolean {
  void store.value;
  void DRAFTS_REV.value;
  return keys.some((k) => !deepEqual(getEffective(store, k), getDefault(store, k)));
}

/**
 * True iff ANY of `refs` (across one or more stores) has an effective value
 * differing from its default. Draft-aware — tracks DRAFTS_REV + each store's
 * value, so it re-runs on any draft or committed change. Used by the
 * Section / CollapsibleSubgroup reset buttons over their descendant fields
 * (replaces the old DOM-scrape that read each `.theme-row-reset`'s disabled).
 */
export function useAnyResettable(refs: ResettableRef[]): boolean {
  void DRAFTS_REV.value;
  for (const r of refs) void r.store.value; // subscribe to each store
  return refs.some((r) => !deepEqual(getEffective(r.store, r.key), getDefault(r.store, r.key)));
}
