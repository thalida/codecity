// components/DebugMenu/DebugMenu.tsx — developer-only diagnostics, in the
// footer behind the flag-gated bug icon (see utils/debugMode).
//
// Open state lives in DEBUG_OPEN so OVERLAY_OPEN can read it.

import { Bug } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/Popover/Popover';
import { DEBUG_OPEN } from '@/state/stores/modals';

export interface DebugMenuProps {
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
  onRunTreeGroundingCheck?: () => void;
}

export function DebugMenu({
  onRunCollisionCheck,
  onRunStemDiagnostic,
  onRunTreeGroundingCheck,
}: DebugMenuProps) {
  return (
    <Popover
      label="Debug"
      placement={PopoverPlacement.AboveStart}
      openSignal={DEBUG_OPEN}
      triggerTitle="Debug tools"
      triggerLabel="Debug tools"
      trigger={<Bug class="icon" aria-hidden="true" />}
    >
      {() => (
        <section class="popover-group">
          {onRunCollisionCheck && (
            <button
              type="button"
              class="btn-secondary popover-action"
              title="Walks the current layout and logs any rect/rect overlaps."
              onClick={() => onRunCollisionCheck()}
            >
              Run collision check
            </button>
          )}
          {onRunStemDiagnostic && (
            <button
              type="button"
              class="btn-secondary popover-action"
              title="Re-runs layout under tracing and logs, per road, the chosen stem and binding obstacle for each child placement."
              onClick={() => onRunStemDiagnostic()}
            >
              Diagnose stem placement
            </button>
          )}
          {onRunTreeGroundingCheck && (
            <button
              type="button"
              class="btn-secondary popover-action"
              title="Measures every tree's lowest trunk vertex against the ground plane and logs any that float or sink."
              onClick={() => onRunTreeGroundingCheck()}
            >
              Audit tree grounding
            </button>
          )}
          <p class="popover-hint">Output goes to the browser console.</p>
        </section>
      )}
    </Popover>
  );
}
