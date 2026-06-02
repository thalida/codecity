// components/LoadingOverlay.tsx — Centered spinner + stepped progress
// indicator shown whenever a manifest is being fetched or applied. Reused for
// cold-boot loads and source-picker submits so the user sees the same UI
// regardless of entry point.
//
// Signal-driven: reads LOADING_OVERLAY and is mounted once by App.tsx. State is
// driven by the uiState helpers (showLoadingOverlay / setLoadingStep /
// setLoadingStepTail / setLoadingPendingLabel / hideLoadingOverlay), called
// from the manifest-stream consumer and the REBUILD_STATUS bridge in
// manifestPoll. Every visible advancement maps to a real NDJSON phase event
// (cloning, scanning, skeleton, building) or the client-side decoration pass —
// no wall-clock timers. The step vocabulary lives in constants/loadingSteps.

import { LOADING_OVERLAY } from '@/state/stores/ui';
import { SourceKind } from '@/utils/sources';
import { LoadingStep, LoadingStepState, LOADING_STEPS, LOADING_STEP_LABELS } from '@/constants/loadingSteps';

// LoadingOverlayShowOpts (the show() contract) lives in state/stores/ui, so
// state stays view-independent.

// ── Internal state shape (for Preact component) ─────────────────────────────

export interface OverlayState {
  visible: boolean;
  kind: SourceKind | null;
  branch: string | null;
  activeStep: LoadingStep | null;
  pendingLabel: string | null;
  stepTails: Partial<Record<LoadingStep, string | null>>;
}

// ── Preact component ────────────────────────────────────────────────────────
// Signal-driven: reads LOADING_OVERLAY directly. No props required.

export function LoadingOverlay() {
  const lo = LOADING_OVERLAY.value;
  const s: OverlayState = {
    visible: lo.visible,
    kind: lo.showOpts?.kind ?? null,
    branch: lo.showOpts?.branch ?? null,
    activeStep: lo.activeStep,
    pendingLabel: lo.pendingLabel,
    stepTails: lo.stepTails,
  };
  if (!s.visible || !s.activeStep) return null;

  const activeStep = s.activeStep;
  const activeIdx = LOADING_STEPS.indexOf(activeStep);

  return (
    <div class="loading-backdrop">
      <div class="loading-card">
        {s.pendingLabel && <div class="loading-pending-label">{s.pendingLabel}</div>}
        <div class="loading-spinner" />
        <div class="text-card-title is-loading" role="status" aria-live="polite">
          {LOADING_STEP_LABELS[activeStep]}
          {s.branch ? ` (branch ${s.branch})` : ''}
          {'…'}
        </div>
        <ol class="loading-steps">
          {LOADING_STEPS.map((step) => {
            const isLocal = s.kind === SourceKind.Local;
            if (isLocal && (step === LoadingStep.Resolving || step === LoadingStep.Cloning)) {
              return (
                <li key={step} data-step={step} data-state={LoadingStepState.Pending} style={{ display: 'none' }}>
                  {LOADING_STEP_LABELS[step]}
                </li>
              );
            }
            const thisIdx = LOADING_STEPS.indexOf(step);
            let stepState: LoadingStepState = LoadingStepState.Pending;
            if (thisIdx < activeIdx) stepState = LoadingStepState.Done;
            else if (thisIdx === activeIdx) stepState = LoadingStepState.Active;
            const tail = s.stepTails[step];
            return (
              <li key={step} data-step={step} data-state={stepState}>
                {LOADING_STEP_LABELS[step]}
                {tail != null && <span class="loading-step-tail"> {tail}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
