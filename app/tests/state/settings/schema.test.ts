import { describe, it, expect } from 'vitest';
import { settingSignal, getFieldDef, getFieldKeys, FieldKind, ChangeRoute } from '@/state/settings/schema';
import { getDefault } from '@/state/persist';

// settingSignal derives the persisted default object from each field's
// `default`, registers the field map for (store, key) lookups, and otherwise
// behaves like persistedSignal (hydration / diff-vs-default / getDefault).

describe('settingSignal', () => {
  const STORE = settingSignal('TEST_SCHEMA_STORE', {
    A: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 5, min: 0, max: 10, step: 1, label: 'A' },
    B: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'B' },
    C: { route: ChangeRoute.Refresh, kind: FieldKind.RangePair, default: [1, 2] as [number, number], min: 0, max: 9, step: 1, label: 'C' },
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
    expect(a?.kind).toBe(FieldKind.Slider);
    expect(a?.max).toBe(10);
    expect(getFieldDef(STORE, 'B')?.kind).toBe(FieldKind.Toggle);
  });

  it('returns undefined for an unknown key or unregistered store', () => {
    expect(getFieldDef(STORE, 'nope')).toBeUndefined();
    expect(getFieldDef({ value: {} }, 'A')).toBeUndefined();
  });

  it('exposes all field keys', () => {
    expect(getFieldKeys(STORE).sort()).toEqual(['A', 'B', 'C']);
  });
});
