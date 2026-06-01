// views/panes/controls/hooks.ts — Reactive bridge between widget components
// and the draft layer. Widgets render with the "effective" value (draft if
// pending, else committed) and re-render whenever EITHER source changes.
//
// Both reads are auto-tracked by Preact: store.value via the signal itself,
// and the draft layer via DRAFTS_REV which is bumped on every mutation in
// state/drafts.

import { useLayoutEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { getEffective, DRAFTS_REV } from '@/state/drafts';
import { getDefault, deepEqual } from '@/state/persist';

interface SignalLike {
  get value(): any;
  set value(v: any);
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
 * Aggregate state for a Section / CollapsibleSubgroup reset button.
 *   hasResettable — at least one descendant <button.theme-row-reset> exists.
 *                   Sections with no resettable rows (Shortcuts, Debug)
 *                   render no section reset button at all.
 *   canReset      — at least one descendant reset button is currently
 *                   enabled (i.e. at least one row differs from default).
 *
 * Queries the DOM (via the passed ref) on every draft-rev tick and re-reads
 * each descendant button's `.disabled` state. Cheaper than rebuilding a
 * cross-component subscription tree and matches the original imperative
 * approach. Reading DRAFTS_REV.value makes the hook re-run whenever any
 * draft changes anywhere.
 */
export function useHasAnyResettableRow(
  ref: RefObject<HTMLElement | null>
): { hasResettable: boolean; canReset: boolean } {
  void DRAFTS_REV.value;
  const [state, setState] = useState({ hasResettable: false, canReset: false });

  useLayoutEffect(() => {
    if (!ref.current) return;
    // Microtask: per-row reset buttons re-render their `disabled` state on
    // the same DRAFTS_REV tick; reading synchronously here would see stale
    // values. queueMicrotask runs after the current render flush.
    queueMicrotask(() => {
      if (!ref.current) return;
      const rowResets = ref.current.querySelectorAll<HTMLButtonElement>('.theme-row-reset');
      const hasResettable = rowResets.length > 0;
      const canReset = hasResettable && Array.from(rowResets).some((b: HTMLButtonElement) => !b.disabled);
      setState((prev) =>
        prev.hasResettable === hasResettable && prev.canReset === canReset ? prev : { hasResettable, canReset }
      );
    });
  });

  return state;
}
