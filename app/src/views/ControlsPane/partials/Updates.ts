// views/ControlsPane/partials/Updates.ts — Live-updates polling section
// declaration (one of two sections in the Scan settings tab).
import { field, type SectionNode } from '.';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';

export const UPDATES_SECTION: SectionNode = {
  key: 'updates',
  label: 'Live updates',
  defaultOpen: true,
  children: [field(LIVE_UPDATES, 'ENABLED'), field(LIVE_UPDATES, 'POLL_SECONDS')],
};
