// components/ResetViewButton.tsx — The gem button at the header's left edge.
// Doubles as the app logo: clicking it resets the camera view (R). Renders
// nothing when no reset handler is wired (pre-boot).

import { GemIcon } from '@/components/GemIcon';

export interface ResetViewButtonProps {
  onResetView?: () => void;
}

export function ResetViewButton({ onResetView }: ResetViewButtonProps) {
  if (!onResetView) return null;
  return (
    <button
      type="button"
      class="btn-icon btn-icon--no-drag"
      title="Reset view (R)"
      aria-label="Reset view"
      onClick={() => onResetView()}
    >
      <GemIcon />
    </button>
  );
}
