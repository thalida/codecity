// hooks/useSettings.ts — settings widgets to the draft layer, at four
// granularities. Every one reads the effective value (draft if any, else
// committed) and re-renders on either, via store.value and DRAFTS_REV.
// See state/settings/README.md.

import { getEffective, setDraft, DRAFTS_REV } from '@/state/settings/drafts';
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

/** One field bound to the draft layer: its effective value, and an onCommit
 *  that stages a draft. */
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

/** Effective value for `store[key]`, or the whole signal when key is null. */
export function useEffective<T = unknown>(store: SignalLike, key: DraftKey): T {
  void store.value;
  void DRAFTS_REV.value;
  return getEffective(store, key) as T;
}

/** Registered default for `store[key]`. Static; a hook only so call sites read
 *  the same way as the others. */
export function useDefault<T = unknown>(store: SignalLike, key: DraftKey): T {
  return (key === null ? getDefault(store) : getDefault(store, key)) as T;
}

/** True iff any of `keys` differs from its default. A row binds one key, or two
 *  for a range pair. */
export function useAnyDiffersFromDefault(store: SignalLike, keys: string[]): boolean {
  void store.value;
  void DRAFTS_REV.value;
  return keys.some((k) => !deepEqual(getEffective(store, k), getDefault(store, k)));
}

/** True iff any of `refs`, across any stores, differs from its default. Backs
 *  the Section and Subgroup reset buttons over their descendant fields. */
export function useAnyResettable(refs: ResettableRef[]): boolean {
  void DRAFTS_REV.value;
  for (const r of refs) void r.store.value; // subscribe to each store
  return refs.some((r) => !deepEqual(getEffective(r.store, r.key), getDefault(r.store, r.key)));
}
