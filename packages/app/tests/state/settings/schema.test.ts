import { describe, it, expect } from 'vitest';
import {
  settingSignal,
  getFieldDef,
  getFieldKeys,
  FieldKind,
  ChangeRoute,
  type FieldMap,
} from '@/features/settings/state/schema';
import { getDefault } from '@/lib/persist';
import { STORAGE_PREFIX } from '@/constants/storage';

// settingSignal derives the defaults and registers the field map, and is
// otherwise persistedSignal.

describe('settingSignal', () => {
  const STORE = settingSignal('TEST_SCHEMA_STORE', {
    A: {
      route: ChangeRoute.Refresh,
      kind: FieldKind.SliderField,
      default: 5,
      min: 0,
      max: 10,
      step: 1,
      label: 'A',
    },
    B: { route: ChangeRoute.Refresh, kind: FieldKind.ToggleField, default: true, label: 'B' },
    C: {
      route: ChangeRoute.Refresh,
      kind: FieldKind.RangePairField,
      default: [1, 2] as [number, number],
      min: 0,
      max: 9,
      step: 1,
      label: 'C',
    },
  });

  it('derives the flat default object from field defaults', () => {
    expect(STORE.value).toEqual({ A: 5, B: true, C: [1, 2] });
  });

  it('registers the default with the persistence layer (getDefault)', () => {
    expect(getDefault(STORE, 'A')).toBe(5);
    expect(getDefault(STORE, 'C')).toEqual([1, 2]);
  });

  it('looks up a field definition by (store, key)', () => {
    const a = getFieldDef(STORE, 'A');
    expect(a?.kind).toBe(FieldKind.SliderField);
    expect(a?.max).toBe(10);
    expect(getFieldDef(STORE, 'B')?.kind).toBe(FieldKind.ToggleField);
  });

  it('returns undefined for an unknown key or unregistered store', () => {
    expect(getFieldDef(STORE, 'nope')).toBeUndefined();
    expect(getFieldDef({ value: {} }, 'A')).toBeUndefined();
  });

  it('exposes all field keys', () => {
    expect(getFieldKeys(STORE).sort()).toEqual(['A', 'B', 'C']);
  });
});

// Validation on load keeps a stale localStorage entry from feeding the scene an
// invalid value: the 0-floor-height to NaN-geometry class of bug.
describe('settingSignal hydration validation', () => {
  const FIELDS: FieldMap = {
    N: {
      route: ChangeRoute.Refresh,
      kind: FieldKind.SliderField,
      default: 16,
      min: 1,
      max: 50,
      label: 'N',
    },
    PAIR: {
      route: ChangeRoute.Refresh,
      kind: FieldKind.RangePairField,
      default: [20, 100] as [number, number],
      min: 0,
      max: 100,
      label: 'PAIR',
    },
    SEL: {
      route: ChangeRoute.Refresh,
      kind: FieldKind.Select,
      default: 'x',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
      ],
      label: 'SEL',
    },
    TOG: { route: ChangeRoute.Refresh, kind: FieldKind.ToggleField, default: true, label: 'TOG' },
  };

  // Seed a persisted diff (persist stores only non-default keys) under a unique
  // key, then hydrate a fresh store from it.
  let n = 0;
  function loadWith(diff: Record<string, unknown>): Record<string, unknown> {
    const key = `SAN_${n++}`;
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(diff));
    return settingSignal(key, FIELDS).value as Record<string, unknown>;
  }

  it('clamps a numeric below min up to min (the 0-floor-height guard)', () => {
    expect(loadWith({ N: 0 }).N).toBe(1);
  });

  it('clamps a numeric above max down to max', () => {
    expect(loadWith({ N: 999 }).N).toBe(50);
  });

  it('resets a non-finite / wrong-type numeric to its default', () => {
    expect(loadWith({ N: 'abc' }).N).toBe(16);
    expect(loadWith({ N: null }).N).toBe(16);
  });

  it('clamps each end of a RangePairField to [min, max]', () => {
    expect(loadWith({ PAIR: [-5, 150] }).PAIR).toEqual([0, 100]);
  });

  it('resets a malformed RangePairField to its default', () => {
    expect(loadWith({ PAIR: [1] }).PAIR).toEqual([20, 100]);
  });

  it('resets a select value that is not a declared option', () => {
    expect(loadWith({ SEL: 'gone' }).SEL).toBe('x');
    expect(loadWith({ SEL: 'y' }).SEL).toBe('y'); // a valid option survives
  });

  it('resets a wrong-typed toggle to its default', () => {
    expect(loadWith({ TOG: 'nope' }).TOG).toBe(true);
  });

  it('leaves an in-range value untouched', () => {
    expect(loadWith({ N: 24 }).N).toBe(24);
  });
});
