// views/panes/controls/sections/updates.ts — Scan & Updates section declaration.
import { field, type SectionNode } from '.';
import { LIVE_UPDATES } from '@/state/settings/updates';

export const UPDATES_SECTION: SectionNode = {
  key: 'updates',
  label: 'Scan & Updates',
  description: 'What the scanner picks up, and how it stays in sync.',
  children: [
    {
      key: 'live-updates',
      label: 'Live updates',
      collapsible: false,
      children: [field(LIVE_UPDATES, 'ENABLED'), field(LIVE_UPDATES, 'POLL_SECONDS')],
    },
  ],
};
