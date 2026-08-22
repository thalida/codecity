// components/loading/LoadingOverlay/LoadingOverlay.tsx — full-viewport centered
// progress, mounted by CityView and driven entirely by the LOADING_OVERLAY
// signal: what raises it and what takes it down is the store's call (see
// attachLoadReaction), so this renders and nothing more.

import './LoadingOverlay.css';
import { LOADING_OVERLAY } from '@/state/stores/progress';
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
