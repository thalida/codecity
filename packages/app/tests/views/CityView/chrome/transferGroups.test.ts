import { CITY_STORES } from '@/state/settings/values/city';
import { describe, it, expect } from 'vitest';
import { TRANSFER_GROUPS } from '@/views/CityView/chrome/CityFooter/transferGroups';
import { CONTROLS_SECTIONS } from '@/views/CityView/panes/ControlsPane/ControlsPane';
import { forEachSettingStore, type SettingStore } from '@/state/settings/schema';
import { getStoreName } from '@/state/persist';
import { SYNTAX_THEME } from '@/state/settings/values/syntaxTheme';
import { LIVE_UPDATES } from '@/state/settings/values/updates';
import { TransferFamily } from '@/state/settings/transfer';
import { NON_TRANSFERABLE } from '@/views/CityView/chrome/CityFooter/transferGroups';

const registered = (): SettingStore[] => {
  const out: SettingStore[] = [];
  forEachSettingStore((s) => out.push(s));
  return out;
};

describe('TRANSFER_GROUPS', () => {
  // The whole point of the picker is that everything the app persists as a
  // setting can travel. A new store lands here or it silently cannot be shared.
  it('places every registered settings store in exactly one group, or declares why not', () => {
    const counts = new Map<SettingStore, number>();
    for (const group of TRANSFER_GROUPS) {
      for (const store of group.stores) counts.set(store, (counts.get(store) ?? 0) + 1);
    }
    const misplaced = registered()
      .filter((store) => !NON_TRANSFERABLE.includes(store))
      .filter((store) => counts.get(store) !== 1)
      .map((store) => `${getStoreName(store) ?? '?'}: ${counts.get(store) ?? 0} groups`);
    expect(misplaced).toEqual([]);
  });

  // The opt-out is a declaration, not a hiding place: a store cannot both
  // refuse to travel and sit in a group that would send it.
  it('never groups a store it also declares non-transferable', () => {
    const grouped = TRANSFER_GROUPS.flatMap((g) => g.stores);
    expect(NON_TRANSFERABLE.filter((s) => grouped.includes(s))).toEqual([]);
  });

  it('keeps auto-refresh out: a poll interval is about this machine, not a look', () => {
    expect(NON_TRANSFERABLE.includes(LIVE_UPDATES)).toBe(true);
  });

  it('offers no empty group, which would tick and export nothing', () => {
    expect(TRANSFER_GROUPS.filter((g) => g.stores.length === 0)).toEqual([]);
  });

  it('keys each group uniquely, since the picker tracks ticks by key', () => {
    const keys = TRANSFER_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mirrors the controls pane one group per section, under the same label', () => {
    for (const section of CONTROLS_SECTIONS) {
      const group = TRANSFER_GROUPS.find((g) => g.key === section.key);
      expect(group?.label).toBe(section.label);
      expect(group?.family).toBe(TransferFamily.Render);
    }
  });

  // includes(), not toContain(): a signal is a live object graph, and the
  // matcher's deep walk of one blows up before it ever compares identities.
  const holds = (key: string, store: SettingStore) =>
    TRANSFER_GROUPS.find((g) => g.key === key)?.stores.includes(store) ?? false;

  it('groups a section store under its section', () => {
    expect(holds('trees', CITY_STORES.TREES)).toBe(true);
  });

  // Its own family, and a row per field, so you can send just the syntax theme.
  it('mirrors the appearance menu one group per field', () => {
    expect(holds('syntax', SYNTAX_THEME)).toBe(true);
    const appearance = TRANSFER_GROUPS.filter((g) => g.family === TransferFamily.Appearance);
    expect(appearance.map((g) => g.key)).toEqual(['accent', 'surface', 'syntax']);
  });
});
