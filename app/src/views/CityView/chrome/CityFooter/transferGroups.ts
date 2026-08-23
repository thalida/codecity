// chrome/CityFooter/transferGroups.ts — how a settings file is sliced up for
// the picker: one family per menu these settings live in. Render is read off
// the controls pane's own sections, so the two cannot drift apart.

import type { SectionChild, SectionNode } from '@/types/controls';
import type { SettingStore } from '@/state/settings/schema';
import { TransferFamily, type TransferGroup } from '@/state/settings/transfer';
import { CONTROLS_SECTIONS } from '@/views/CityView/panes/ControlsPane/ControlsPane';
import { ACCENT_THEME, SURFACE_THEME } from '@/state/settings/fields/theme';
import { SYNTAX_THEME } from '@/state/settings/fields/syntaxTheme';
import { LIVE_UPDATES } from '@/city/session/settings/updates';

/** Settings that deliberately do not travel. Auto-refresh is a fact about this
 *  machine and this server, not a look: an imported 1s poll hammers a stranger's. */
export const NON_TRANSFERABLE: SettingStore[] = [LIVE_UPDATES];

function collectStores(children: SectionChild[], into: SettingStore[]): void {
  for (const child of children) {
    if ('store' in child) {
      if (!into.includes(child.store)) into.push(child.store);
    } else {
      collectStores(child.children, into);
    }
  }
}

function fromSection(section: SectionNode): TransferGroup {
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
  ...CONTROLS_SECTIONS.map(fromSection),
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
