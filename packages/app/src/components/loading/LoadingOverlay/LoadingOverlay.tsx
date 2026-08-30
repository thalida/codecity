// components/loading/LoadingOverlay/LoadingOverlay.tsx — Full-viewport centered progress, mounted once
// by App.tsx and driven by the LOADING_OVERLAY signal. Narrow role by design: a
// load driven from <ProjectsView> renders its OWN inline progress and this
// suppresses itself (below), so two full-viewport surfaces never stack.

import './LoadingOverlay.css';
import { LOADING_OVERLAY } from '@/views/CityView/state/overlay';
import { LoadingProgress } from '@/components/loading/LoadingProgress/LoadingProgress';

export interface LoadingOverlayProps {
  // Aborts the cold-boot load and opens the project list (App wires both).
  onCancel: () => void;
}

export function LoadingOverlay({ onCancel }: LoadingOverlayProps) {
  const lo = LOADING_OVERLAY.value;
  if (!lo.visible || !lo.activeStep) return null;

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
