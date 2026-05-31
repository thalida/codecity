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
// Preact component: LoadingOverlay (signal-driven; for future Phase 3c/3d use).
// Backward-compat factory: createLoadingOverlay (imperative DOM; callers in
// main.ts use this until Phase 3c ports them).

import type { Signal } from '@preact/signals';

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

export interface LoadingOverlay {
  show(opts: LoadingOverlayShowOpts): void;
  setStep(step: LoadingStep): void;
  setPendingLabel(label: string | null): void;
  setStepTail(step: LoadingStep, tail: string | null): void;
  hide(): void;
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
// Used by future Phase 3c/3d callers via <LoadingOverlay state={...} />.

export interface LoadingOverlayProps {
  state: Signal<OverlayState>;
}

export function LoadingOverlay({ state }: LoadingOverlayProps) {
  const s = state.value;
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

// ── Backward-compat factory (Phase 3c/3d will delete this) ─────────────────
//
// Uses imperative DOM mutations (innerHTML + style manipulation) so the
// synchronous test assertions in tests/views/components/loadingOverlay.test.ts
// work without needing Preact's async render flush. The LoadingOverlay
// component above is for future direct JSX usage.

export function createLoadingOverlay(): LoadingOverlay {
  const root = document.getElementById('loading-overlay-root');
  if (!root) {
    return {
      show: () => {},
      setStep: () => {},
      setPendingLabel: () => {},
      setStepTail: () => {},
      hide: () => {},
    };
  }

  // DOM refs — populated on first show().
  let _titleEl: HTMLElement | null = null;
  let _stepEls: Partial<Record<LoadingStep, HTMLElement>> = {};

  function _buildDOM(): void {
    root.innerHTML = `
      <div class="loading-backdrop">
        <div class="loading-card">
          <div class="loading-spinner"></div>
          <div class="text-card-title is-loading" role="status" aria-live="polite"></div>
          <ol class="loading-steps">
            <li data-step="resolving" data-state="pending">${STEP_LABELS.resolving}</li>
            <li data-step="cloning"   data-state="pending">${STEP_LABELS.cloning}</li>
            <li data-step="scanning"  data-state="pending">${STEP_LABELS.scanning}</li>
            <li data-step="skeleton"  data-state="pending">${STEP_LABELS.skeleton}</li>
            <li data-step="building"  data-state="pending">${STEP_LABELS.building}</li>
            <li data-step="decorating" data-state="pending">${STEP_LABELS.decorating}</li>
          </ol>
        </div>
      </div>
    `;

    _titleEl = root.querySelector('.text-card-title.is-loading');
    _stepEls = {};
    for (const step of ALL_STEPS) {
      _stepEls[step] =
        (root.querySelector(`[data-step="${step}"]`) as HTMLElement | null) ?? undefined;
    }
  }

  function _setStepState(step: LoadingStep, state: 'pending' | 'active' | 'done'): void {
    const el = _stepEls[step];
    if (el) el.setAttribute('data-state', state);
  }

  // Apply current step to DOM: everything before → done, target → active,
  // everything after → pending.
  function _applyStep(step: LoadingStep): void {
    let found = false;
    for (const s of ALL_STEPS) {
      if (s === step) {
        _setStepState(s, 'active');
        found = true;
      } else if (!found) {
        _setStepState(s, 'done');
      } else {
        _setStepState(s, 'pending');
      }
    }
  }

  return {
    show({ kind, label, branch }: LoadingOverlayShowOpts) {
      _buildDOM();

      // Hide git-only steps for local sources.
      const initialStep: LoadingStep = kind === 'local' ? 'scanning' : 'resolving';
      if (kind === 'local') {
        const resolvingEl = _stepEls['resolving'];
        const cloningEl = _stepEls['cloning'];
        if (resolvingEl) resolvingEl.style.display = 'none';
        if (cloningEl) cloningEl.style.display = 'none';
      }
      _applyStep(initialStep);

      // Title shows the current step in sentence form ("Resolving source…",
      // "Cloning…"), updated by setStep below. Previously it repeated the
      // project name ("Loading <label>…") but that duplicated the
      // pending-label header that setPendingLabel mounts directly above
      // the spinner — same string twice. The step text is also more
      // informative and updates as work progresses (a11y win for the
      // aria-live title region). The `branch` field is shown once via
      // a parenthetical on the initial title so the user can confirm
      // which branch is being fetched before any stream events arrive.
      if (_titleEl) {
        const suffix = branch ? ` (branch ${branch})` : '';
        _titleEl.textContent = `${STEP_LABELS[initialStep]}${suffix}…`;
      }
      // `label` is used by setPendingLabel callers from main.ts; we
      // deliberately don't show it in the title here.
      void label;

      root.style.display = 'block';
    },

    setStep(step: LoadingStep) {
      _applyStep(step);
      if (_titleEl) {
        _titleEl.textContent = `${STEP_LABELS[step]}…`;
      }
    },

    setPendingLabel(label: string | null) {
      // Mounts the header into the loading-card so it sits above the
      // spinner. If show() hasn't run yet there's no card to inject
      // into — silently noop in that case; the next show() will rebuild
      // the DOM and any subsequent setPendingLabel call will find a card.
      const card = root.querySelector('.loading-card');
      if (!card) return;
      const existing = card.querySelector('.loading-pending-label');
      if (label === null) {
        existing?.remove();
        return;
      }
      if (existing) {
        existing.textContent = label;
        return;
      }
      const header = document.createElement('div');
      header.className = 'loading-pending-label';
      header.textContent = label;
      card.insertBefore(header, card.firstChild);
    },

    setStepTail(step: LoadingStep, tail: string | null) {
      // Append (or replace, or remove) a small trailing string on a
      // step row — used for live progress like "45% (receiving)" while
      // cloning and "1,234 files" while scanning. The tail lives in a
      // dedicated <span> so the step label stays untouched and a single
      // remove() restores the original DOM.
      const row = _stepEls[step];
      if (!row) return;
      let tailEl = row.querySelector('.loading-step-tail');
      if (tail === null) {
        tailEl?.remove();
        return;
      }
      if (!tailEl) {
        tailEl = document.createElement('span');
        tailEl.className = 'loading-step-tail';
        row.appendChild(tailEl);
      }
      tailEl.textContent = ` ${tail}`;
    },

    hide() {
      root.style.display = 'none';
    },
  };
}
