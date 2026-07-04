// views/ControlsPane/partials/Updates.ts — Scan & Updates section declaration.
import { field, type SectionNode } from '.';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';

export const UPDATES_SECTION: SectionNode = {
  key: 'updates',
  label: 'Scan & Updates',
  children: [
    {
      key: 'live-updates',
      label: 'Live updates',
      collapsible: false,
      children: [field(LIVE_UPDATES, 'ENABLED'), field(LIVE_UPDATES, 'POLL_SECONDS')],
    },
  ],
};
