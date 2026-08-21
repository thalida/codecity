import { describe, it, expect } from 'vitest';
import { TRANSFER_GROUPS } from '@/views/CityView/chrome/CityFooter/transferGroups';
import { CONTROLS_SECTIONS } from '@/views/CityView/panes/ControlsPane/ControlsPane';
import { forEachSettingStore, type SettingStore } from '@/state/settings/schema';
import { getStoreName } from '@/state/persist';
import { TREES } from '@/state/settings/fields/trees';
import { SYNTAX_THEME } from '@/state/settings/fields/syntaxTheme';
import { LIVE_UPDATES } from '@/state/settings/fields/updates';
import { TransferFamily } from '@/state/settings/transfer';

const registered = (): SettingStore[] => {
  const out: SettingStore[] = [];
  forEachSettingStore((s) => out.push(s));
  return out;
};

describe('TRANSFER_GROUPS', () => {
  // The whole point of the picker is that everything the app persists as a
  // setting can travel. A new store lands here or it silently cannot be shared.
  it('places every registered settings store in exactly one group', () => {
    const counts = new Map<SettingStore, number>();
    for (const group of TRANSFER_GROUPS) {
      for (const store of group.stores) counts.set(store, (counts.get(store) ?? 0) + 1);
    }
    const misplaced = registered()
      .filter((store) => counts.get(store) !== 1)
      .map((store) => `${getStoreName(store) ?? '?'}: ${counts.get(store) ?? 0} groups`);
    expect(misplaced).toEqual([]);
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
      expect(group?.family).toBe(TransferFamily.World);
    }
  });

  // includes(), not toContain(): a signal is a live object graph, and the
  // matcher's deep walk of one blows up before it ever compares identities.
  const holds = (key: string, store: SettingStore) =>
    TRANSFER_GROUPS.find((g) => g.key === key)?.stores.includes(store) ?? false;

  it('groups a section store under its section', () => {
    expect(holds('trees', TREES)).toBe(true);
  });

  it('carries the panel-less settings the controls pane never shows', () => {
    expect(holds('appearance', SYNTAX_THEME)).toBe(true);
    expect(holds('updates', LIVE_UPDATES)).toBe(true);
    expect(TRANSFER_GROUPS.find((g) => g.key === 'updates')?.family).toBe(TransferFamily.Scan);
  });
});
