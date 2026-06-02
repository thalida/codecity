// hooks/useSettings.ts — Preact hooks bridging settings widgets to the draft
// layer (state/settingsDrafts) and registered defaults (state/persist). They're
// all thin reactive wrappers over the same two sources: each reads the
// "effective" value (pending draft if any, else committed) and re-renders
// whenever EITHER changes — the store signal via store.value, and the draft
// layer via DRAFTS_REV (bumped on every mutation in state/settingsDrafts).
//
// Same layer, different granularity:
//   useField                — per-field binding ({ value, onCommit }); <Field> uses it.
//   useEffective / useDefault — a field's effective value / its registered default.
//   useDiffersFromDefault / useAnyDiffersFromDefault / useAnyResettable
//                           — reset-button enabled state over one or more fields.

import { getEffective, setDraft, DRAFTS_REV } from '@/state/settingsDrafts';
import { getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

/** The reactive binding for a single settings field: its effective value plus
 *  an onCommit that stages a draft. The generic <Field> renders from this. */
export interface FieldBinding<T> {
  value: T;
  onCommit: (v: T) => void;
}

/**
 * Bind one settings field to the draft layer. Returns the effective value
 * (pending draft if any, else committed) and an onCommit that stages a draft.
 * Tracks both the store signal and DRAFTS_REV so the component re-renders when
 * either the underlying value or a draft changes.
 */
export function useField<T = unknown>(store: SignalLike, key: string): FieldBinding<T> {
  void store.value;
  void DRAFTS_REV.value;
  return {
    value: getEffective(store, key) as T,
    onCommit: (v: T) => setDraft(store, key, v),
  };
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
 * Section / Subgroup reset buttons over their descendant fields
 * (replaces the old DOM-scrape that read each `.theme-row-reset`'s disabled).
 */
export function useAnyResettable(refs: ResettableRef[]): boolean {
  void DRAFTS_REV.value;
  for (const r of refs) void r.store.value; // subscribe to each store
  return refs.some((r) => !deepEqual(getEffective(r.store, r.key), getDefault(r.store, r.key)));
}
