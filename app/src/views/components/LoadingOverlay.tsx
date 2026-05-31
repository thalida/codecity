// views/components/loadingOverlay.tsx — Centered spinner + stepped progress indicator shown
// whenever a manifest is being fetched or applied. Reused for direct-boot
// loads and modal submits so the user sees the same UI regardless of entry
// point.
//
// Step transitions are driven entirely by setStep() calls from the
// manifest-stream consumer in main.ts — every visible advancement maps
// to a real NDJSON phase event from the server (cloning, scanning,
// skeleton, final). No wall-clock timers.
//
// API:
//   show({ kind, label, branch? }) — display overlay at the initial step
//                                    (resolving for git, scanning for local)
//   setStep(step)                  — advance to a step in response to a
//                                    server-emitted phase event
//   setPendingLabel(label | null)  — mount/replace/remove a project-label
//                                    header above the spinner. Called from
//                                    main.ts when the first stream event
//                                    carries the server-resolved
//                                    display_root, so the overlay shows
//                                    "owner/repo" before any manifest exists.
//   setStepTail(step, tail | null) — append a per-step tail string (e.g.
//                                    "45% (receiving)" while cloning, or
//                                    "1,234 files" while scanning). Driven
//                                    from main.ts when the stream emits
//                                    cloning/scanning events with progress
//                                    fields. Passing null removes the tail.
//   hide()                         — dismiss overlay
//
// Preact component: LoadingOverlay — signal-driven, reads LOADING_OVERLAY and
// is mounted by App.tsx. State is driven by the uiState helpers
// (showLoadingOverlay / setLoadingStep / setLoadingStepTail / …) called from
// the manifest-stream consumer and liveStatusBridge.

import { LOADING_OVERLAY } from '@/state/runtime/uiState';

export type LoadingStep =
  | 'resolving'
  | 'cloning'
  | 'scanning'
  | 'skeleton'
  | 'building'
  // Client-side phase after the city is in the scene but before the
  // decoration pass (trees, future mesa bounds) finishes. Triggered
  // by REBUILD_STATUS → 'decorating' in main.ts. Only inserted when
  // at least one decoration layer is enabled.
  | 'decorating';

export interface LoadingOverlayShowOpts {
  kind: 'git' | 'local';
  label: string;
  branch?: string;
}

// Steps in display order. 'skeleton' is the placeholder-painting phase
// while the server resolves per-file metadata; 'building' is the final
// tween-in of real building heights from the populated manifest.
const ALL_STEPS: LoadingStep[] = [
  'resolving',
  'cloning',
  'scanning',
  'skeleton',
  'building',
  'decorating',
];

// Human-readable label for each step.
const STEP_LABELS: Record<LoadingStep, string> = {
  resolving: 'Resolving source',
  cloning: 'Cloning',
  scanning: 'Scanning files',
  skeleton: 'Sketching layout',
  building: 'Building city',
  decorating: 'Adding decorations',
};

// ── Internal state shape (for Preact component) ─────────────────────────────

export interface OverlayState {
  visible: boolean;
  kind: 'git' | 'local' | null;
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
  const activeIdx = ALL_STEPS.indexOf(activeStep);

  return (
    <div class="loading-backdrop">
      <div class="loading-card">
        {s.pendingLabel && <div class="loading-pending-label">{s.pendingLabel}</div>}
        <div class="loading-spinner" />
        <div class="text-card-title is-loading" role="status" aria-live="polite">
          {STEP_LABELS[activeStep]}
          {s.branch ? ` (branch ${s.branch})` : ''}
          {'…'}
        </div>
        <ol class="loading-steps">
          {ALL_STEPS.map((step) => {
            const isLocal = s.kind === 'local';
            if (isLocal && (step === 'resolving' || step === 'cloning')) {
              return (
                <li key={step} data-step={step} data-state="pending" style={{ display: 'none' }}>
                  {STEP_LABELS[step]}
                </li>
              );
            }
            const thisIdx = ALL_STEPS.indexOf(step);
            let stepState: 'pending' | 'active' | 'done' = 'pending';
            if (thisIdx < activeIdx) stepState = 'done';
            else if (thisIdx === activeIdx) stepState = 'active';
            const tail = s.stepTails[step];
            return (
              <li key={step} data-step={step} data-state={stepState}>
                {STEP_LABELS[step]}
                {tail != null && <span class="loading-step-tail"> {tail}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
