// views/ControlsPane/partials/Updates.tsx — Auto-refresh polling section
// declaration (one of two sections in the Scan settings tab).
import { field, type SectionNode } from '.';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { AutoRefreshScope } from './AutoRefreshScope';

export const UPDATES_SECTION: SectionNode = {
  key: 'updates',
  label: 'Auto-refresh',
  description: <AutoRefreshScope />,
  defaultOpen: true,
  children: [field(LIVE_UPDATES, 'ENABLED'), field(LIVE_UPDATES, 'POLL_SECONDS')],
};
