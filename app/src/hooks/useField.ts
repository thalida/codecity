// src/hooks/useField.ts — Bind a single settings field to the draft layer.
//
// Returns the effective value (pending draft if any, else committed) and an
// onCommit that stages a draft. Tracks both the store signal and DRAFTS_REV so
// the component re-renders when either the underlying value or a draft changes.
// The generic <Field> uses this; it replaces the per-component useEffective +
// setDraft wiring the old Fields.tsx variants each repeated.

import { getEffective, setDraft, DRAFTS_REV } from '@/state/drafts';

interface SignalLike {
  get value(): unknown;
  set value(v: unknown);
}

export interface FieldBinding<T> {
  value: T;
  onCommit: (v: T) => void;
}

export function useField<T = unknown>(store: SignalLike, key: string): FieldBinding<T> {
  // Track both sources so the binding is reactive.
  void store.value;
  void DRAFTS_REV.value;
  return {
    value: getEffective(store, key) as T,
    onCommit: (v: T) => setDraft(store, key, v),
  };
}
