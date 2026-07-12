// components/LoadingProgress/LoadingProgress.tsx — the shared loading column:
// repo label + spinner + current-step status + the stepped progress list.
// Rendered by both the app-level LoadingOverlay (deep-link cold boot) and
// ProjectsView's inline progress (every in-app switch), so the phase→step
// state mapping has exactly one definition and the two surfaces never drift.

import './LoadingProgress.css';
import { PENDING_SOURCE_LABEL } from '@/state/stores/source';
import { SourceKind } from '@/utils/sources';
import {
  LoadingStep,
  LoadingStepState,
  LOADING_STEPS,
  LOADING_STEP_LABELS,
} from '@/constants/loadingSteps';

export interface LoadingProgressProps {
  activeStep: LoadingStep;
  kind: SourceKind | null;
  branch?: string | null;
  // Trailing per-step progress text (clone %, scanned file count). Only the
  // overlay flow supplies these; ProjectsView omits them.
  stepTails?: Partial<Record<LoadingStep, string | null>>;
}

export function LoadingProgress({ activeStep, kind, branch, stepTails }: LoadingProgressProps) {
  const pendingLabel = PENDING_SOURCE_LABEL.value;
  const activeIdx = LOADING_STEPS.indexOf(activeStep);
  const isLocal = kind === SourceKind.Local;

  return (
    <>
      {pendingLabel && <div class="loading-pending-label">{pendingLabel}</div>}
      <div class="loading-spinner" />
      <div class="loading-status" role="status" aria-live="polite">
        {LOADING_STEP_LABELS[activeStep]}
        {branch ? ` (branch ${branch})` : ''}
        {'…'}
      </div>
      <ol class="loading-steps">
        {LOADING_STEPS.map((step) => {
          // Local sources skip resolve/clone; keep the rows in the DOM (hidden)
          // so the list height doesn't jump when the flow starts.
          if (isLocal && (step === LoadingStep.Resolving || step === LoadingStep.Cloning)) {
            return (
              <li
                key={step}
                data-step={step}
                data-state={LoadingStepState.Pending}
                style={{ display: 'none' }}
              >
                {LOADING_STEP_LABELS[step]}
              </li>
            );
          }
          const thisIdx = LOADING_STEPS.indexOf(step);
          let stepState: LoadingStepState = LoadingStepState.Pending;
          if (thisIdx < activeIdx) stepState = LoadingStepState.Done;
          else if (thisIdx === activeIdx) stepState = LoadingStepState.Active;
          const tail = stepTails?.[step];
          return (
            <li key={step} data-step={step} data-state={stepState}>
              {LOADING_STEP_LABELS[step]}
              {tail != null && <span class="loading-step-tail"> {tail}</span>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
