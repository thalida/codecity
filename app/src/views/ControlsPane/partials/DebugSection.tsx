// views/ControlsPane/DebugSection.tsx — Developer-only diagnostics.
// Output goes to the browser console. Each button is rendered only
// when its callback is provided; either or both may be present.

import { Section } from '@/components/Section';

export interface DebugSectionProps {
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export function DebugSection({ onRunCollisionCheck, onRunStemDiagnostic }: DebugSectionProps) {
  if (!onRunCollisionCheck && !onRunStemDiagnostic) return null;
  return (
    <Section
      name="Debug"
      hint="Developer-only diagnostics. Output goes to the browser console."
    >
      {onRunCollisionCheck && (
        <div class="theme-row">
          <button
            type="button"
            class="btn-secondary"
            title="Walks the current layout and logs any rect/rect overlaps."
            onClick={() => onRunCollisionCheck()}
          >
            Run collision check
          </button>
        </div>
      )}
      {onRunStemDiagnostic && (
        <div class="theme-row">
          <button
            type="button"
            class="btn-secondary"
            title="Re-runs layout under tracing and logs, per road, the chosen stem and binding obstacle for each child placement."
            onClick={() => onRunStemDiagnostic()}
          >
            Diagnose stem placement
          </button>
        </div>
      )}
    </Section>
  );
}
