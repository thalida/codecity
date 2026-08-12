// components/DebugMenu/DebugMenu.tsx — developer-only diagnostics, in the
// footer behind the flag-gated bug icon (see utils/debugMode).
//
// Open state lives in DEBUG_OPEN so OVERLAY_OPEN can read it.

import './DebugMenu.css';
import { Bug } from 'lucide-preact';
import { Popover, PopoverPlacement } from '@/components/Popover/Popover';
import { DEBUG_OPEN } from '@/state/stores/ui';

export interface DebugMenuProps {
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export function DebugMenu({ onRunCollisionCheck, onRunStemDiagnostic }: DebugMenuProps) {
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
              class="btn-secondary debug-action"
              title="Walks the current layout and logs any rect/rect overlaps."
              onClick={() => onRunCollisionCheck()}
            >
              Run collision check
            </button>
          )}
          {onRunStemDiagnostic && (
            <button
              type="button"
              class="btn-secondary debug-action"
              title="Re-runs layout under tracing and logs, per road, the chosen stem and binding obstacle for each child placement."
              onClick={() => onRunStemDiagnostic()}
            >
              Diagnose stem placement
            </button>
          )}
          <p class="popover-hint">Output goes to the browser console.</p>
        </section>
      )}
    </Popover>
  );
}
