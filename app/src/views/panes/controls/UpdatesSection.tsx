// views/panes/controls/UpdatesSection.tsx — Live-update polling config.
// What the scanner picks up + when to re-scan. The poll interval is
// clamped to [1s, 60s] elsewhere so an over-eager value can't ddos the
// local server.

import { LIVE_UPDATES } from '@/state/settings/index';
import { Section } from './Section';
import { Subgroup } from './Subgroup';
import { ToggleField, NumberField } from './Fields';

export function UpdatesSection() {
  return (
    <Section
      name="Scan & Updates"
      hint="What the scanner picks up, and how it stays in sync."
    >
      <Subgroup name="Live updates">
        <ToggleField
          label="Enabled"
          store={LIVE_UPDATES}
          fieldKey="ENABLED"
          tip="When on, the city re-renders in place every poll interval if the scanned tree's mtime/size signature changed."
        />
        <NumberField
          label="Poll interval (s)"
          store={LIVE_UPDATES}
          fieldKey="POLL_SECONDS"
          min={1}
          max={60}
          step={1}
          tip="How often to re-fetch the manifest. Lower = snappier; higher = lighter on the local server. Below 1s hammers the backend; above 60s the city feels stale."
        />
      </Subgroup>
    </Section>
  );
}
