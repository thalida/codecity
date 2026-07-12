import { describe, it, expect } from 'vitest';
import { forEachSettingStore, getFieldKeys, getFieldDef } from '@/state/settingsSchema';
// Import every settings store so it self-registers before we iterate.
import '@/state/stores/settings/buildings';
import '@/state/stores/settings/camera';
import '@/state/stores/settings/effects';
import '@/state/stores/settings/fireflies';
import '@/state/stores/settings/footprint';
import '@/state/stores/settings/gem';
import '@/state/stores/settings/island';
import '@/state/stores/settings/scene';
import '@/state/stores/settings/streets';
import '@/state/stores/settings/syntaxTheme';
import '@/state/stores/settings/trees';
import '@/state/stores/settings/updates';

describe('field descriptions', () => {
  it('contain no em-dashes (use colons or commas)', () => {
    const offenders: string[] = [];
    forEachSettingStore((store) => {
      for (const key of getFieldKeys(store as object)) {
        const tip = getFieldDef(store as object, key)?.tip;
        if (tip && tip.includes('—')) offenders.push(`${key}: ${tip}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
