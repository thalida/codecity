// features/city/components/CityFooter/transferGroups.ts — how a settings file is sliced up for
// the picker: one family per menu these settings live in. Render is read off
// the controls pane's own sections, so the two cannot drift apart.

import type { SectionChild, SectionNode } from '@/features/city/components/ControlsPane/types';
import type { SettingStore } from '@/features/settings/state/schema';
import { TransferFamily, type TransferGroup } from '@/features/settings/state/transfer';
import { CONTROLS_SECTIONS } from '@/features/city/components/ControlsPane/ControlsPane';
import { ACCENT_THEME, SURFACE_THEME } from '@/features/settings/state/values/theme';
import { SYNTAX_THEME } from '@/features/settings/state/values/syntaxTheme';
import { LIVE_UPDATES } from '@/features/settings/state/values/updates';

/** Settings that deliberately do not travel. Auto-refresh is a fact about this
 *  machine and this server, not a look: an imported 1s poll hammers a stranger's. */
export const NON_TRANSFERABLE: SettingStore[] = [LIVE_UPDATES];

function collectStores(children: SectionChild[], into: SettingStore[]): void {
  for (const child of children) {
    if ('store' in child) {
      // Enforced where the groups are built, so a store added to a pane
      // tomorrow does not start travelling because nobody checked.
      if (NON_TRANSFERABLE.includes(child.store)) continue;
      if (!into.includes(child.store)) into.push(child.store);
    } else {
      collectStores(child.children, into);
    }
  }
}

/** One controls-pane section as a transfer group. Exported for the rule above:
 *  what a section contributes is what a settings file carries. */
export function groupForSection(section: SectionNode): TransferGroup {
  const stores: SettingStore[] = [];
  collectStores(section.children ?? [], stores);
  return {
    key: section.key,
    label: section.label ?? section.key,
    family: TransferFamily.Render,
    stores,
  };
}

/** Every group a settings file can carry, in picker order. Render mirrors the
 *  controls pane's sections; Appearance mirrors the fields in its own menu. */
export const TRANSFER_GROUPS: TransferGroup[] = [
  ...CONTROLS_SECTIONS.map(groupForSection),
  {
    key: 'accent',
    label: 'Accent Color',
    family: TransferFamily.Appearance,
    stores: [ACCENT_THEME],
  },
  {
    key: 'surface',
    label: 'Surface Palette',
    family: TransferFamily.Appearance,
    stores: [SURFACE_THEME],
  },
  {
    key: 'syntax',
    label: 'Syntax Theme',
    family: TransferFamily.Appearance,
    stores: [SYNTAX_THEME],
  },
];
