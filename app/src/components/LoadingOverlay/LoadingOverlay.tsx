// components/LoadingOverlay.tsx — Full-viewport centered progress shown for a
// deep-link cold boot (no page open yet). Mounted once by App.tsx and driven by
// the LOADING_OVERLAY signal (fed by the SCAN_PROGRESS reaction and the
// REBUILD_STATUS → Decorating bridge). The inner column — repo label, spinner,
// current step, and stepped list — is the shared <LoadingProgress>, which
// ProjectsView also renders for in-app switches.
//
// Narrow role by design: a load driven from <ProjectsView> renders its OWN
// inline progress and this overlay suppresses itself (below), so two
// full-viewport surfaces never stack.

import './LoadingOverlay.css';
import { LOADING_OVERLAY, PROJECTS_VIEW } from '@/state/stores/ui';
import { LoadingProgress } from '@/components/LoadingProgress/LoadingProgress';

export interface LoadingOverlayProps {
  // Aborts the cold-boot load and opens the project list (App wires both).
  onCancel: () => void;
}

export function LoadingOverlay({ onCancel }: LoadingOverlayProps) {
  const lo = LOADING_OVERLAY.value;
  if (!lo.visible || !lo.activeStep) return null;
  if (PROJECTS_VIEW.value.visible) return null;

  return (
    <div class="loading-backdrop">
      <div class="loading-card card-overlay surface-glass">
        <LoadingProgress
          activeStep={lo.activeStep}
          kind={lo.showOpts?.kind ?? null}
          branch={lo.showOpts?.branch ?? null}
          stepTails={lo.stepTails}
          steps={lo.showOpts?.steps}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
