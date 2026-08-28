// components/loading/LoadingProgress/LoadingProgress.tsx — the shared loading column:
// repo label + spinner + current-step status + the stepped progress list.
// Rendered by both the app-level LoadingOverlay (deep-link cold boot) and
// ProjectsView's inline progress, so the phase→step mapping has one definition.

import './LoadingProgress.css';
import { BranchPill } from '@/components/sources/BranchPill/BranchPill';

import { SourceKind } from '@codecity/city';
import {
  LoadingStep,
  LoadingStepState,
  LOADING_STEPS,
  LOADING_STEP_LABELS,
  stepRuns,
} from '@/constants/progress';
import { PENDING_SOURCE_LABEL } from '@/state/stores/progress';

export interface LoadingProgressProps {
  activeStep: LoadingStep;
  kind: SourceKind | null;
  branch?: string | null;
  // Trailing per-step progress text (clone %, scanned file count). Only the
  // overlay flow supplies these; ProjectsView omits them.
  stepTails?: Partial<Record<LoadingStep, string | null>>;
  // Custom step list (e.g. Timeline-mode entry). Defaults to LOADING_STEPS.
  steps?: readonly LoadingStep[];
  // Aborts the load and returns to the project list. Each surface wires the
  // routing (ProjectsView is already the list; the overlay opens it).
  onCancel: () => void;
}

export function LoadingProgress({
  activeStep,
  kind,
  branch,
  stepTails,
  steps = LOADING_STEPS,
  onCancel,
}: LoadingProgressProps) {
  const pendingLabel = PENDING_SOURCE_LABEL.value;
  const activeIdx = steps.indexOf(activeStep);

  return (
    <>
      {/* Always rendered: the label lands a beat after the overlay does, and a
          row appearing under it would jog everything below. */}
      <div class="loading-header">
        <span class="loading-pending-label" title={pendingLabel ?? undefined}>
          {pendingLabel}
        </span>
        {branch && <BranchPill branch={branch} />}
      </div>
      <div class="loading-spinner" />
      <div class="loading-status" role="status" aria-live="polite">
        {LOADING_STEP_LABELS[activeStep]}
        {'…'}
      </div>
      <ol class="loading-steps">
        {steps.map((step) => {
          // A step this kind never runs keeps its row in the DOM, hidden, so
          // the list height doesn't jump when the flow starts.
          if (!stepRuns(step, kind)) {
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
          const thisIdx = steps.indexOf(step);
          let stepState: LoadingStepState = LoadingStepState.Pending;
          if (thisIdx < activeIdx) stepState = LoadingStepState.Done;
          else if (thisIdx === activeIdx) stepState = LoadingStepState.Active;
          const tail = stepTails?.[step];
          return (
            <li key={step} data-step={step} data-state={stepState}>
              {LOADING_STEP_LABELS[step]}
              {tail != null && <span class="loading-step-tail">{tail}</span>}
            </li>
          );
        })}
      </ol>
      <button type="button" class="btn-secondary loading-cancel" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
