// chrome/CityFooter/transferGroups.ts — how a settings file is sliced up for
// the picker. The world groups are read off the controls pane's own sections,
// so a field that moves section moves group with it and neither can drift.

import type { SectionChild, SectionNode } from '@/types/controls';
import type { SettingStore } from '@/state/settings/schema';
import { TransferFamily, type TransferGroup } from '@/state/settings/transfer';
import { CONTROLS_SECTIONS } from '@/views/CityView/panes/ControlsPane/ControlsPane';
import { ACCENT_THEME, SURFACE_THEME } from '@/state/settings/fields/theme';
import { SYNTAX_THEME } from '@/state/settings/fields/syntaxTheme';
import { LIVE_UPDATES } from '@/state/settings/fields/updates';

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
    family: TransferFamily.World,
    stores,
  };
}

/** Every group a settings file can carry, in picker order. Appearance and
 *  auto-refresh have no section of their own, so they are named here. */
export const TRANSFER_GROUPS: TransferGroup[] = [
  ...CONTROLS_SECTIONS.map(fromSection),
  {
    key: 'appearance',
    label: 'Appearance',
    family: TransferFamily.World,
    stores: [ACCENT_THEME, SURFACE_THEME, SYNTAX_THEME],
  },
  {
    key: 'updates',
    label: 'Auto-refresh',
    family: TransferFamily.Scan,
    stores: [LIVE_UPDATES],
  },
];
