// loadingOverlay.ts — Centered spinner + stepped progress indicator shown
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
//   hide()                         — dismiss overlay

export type LoadingStep =
  | 'resolving'
  | 'cloning'
  | 'scanning'
  | 'skeleton'
  | 'building'
  // Client-side phase after the city is in the scene but before the
  // decoration pass (trees, bushes, future mesa bounds) finishes. Triggered
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

export function createLoadingOverlay(): LoadingOverlay {
  const root = document.getElementById('loading-overlay-root');
  if (!root) {
    return {
      show: () => {},
      setStep: () => {},
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

    _titleEl   = root.querySelector('.text-card-title.is-loading');
    _stepEls   = {};
    for (const step of ALL_STEPS) {
      _stepEls[step] = root.querySelector(`[data-step="${step}"]`) as HTMLElement | null ?? undefined;
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

      // Set title.
      if (_titleEl) {
        _titleEl.textContent = branch
          ? `Loading ${label} (branch ${branch})…`
          : `Loading ${label}…`;
      }

      // Hide git-only steps for local sources.
      if (kind === 'local') {
        const resolvingEl = _stepEls['resolving'];
        const cloningEl   = _stepEls['cloning'];
        if (resolvingEl) resolvingEl.style.display = 'none';
        if (cloningEl)   cloningEl.style.display   = 'none';
        _applyStep('scanning');
      } else {
        // Git sources: start at 'resolving'. The server emits 'cloning'
        // immediately after receiving the request, so the next setStep
        // call from main.ts moves us forward within milliseconds.
        _applyStep('resolving');
      }

      root.style.display = 'block';
    },

    setStep(step: LoadingStep) {
      _applyStep(step);
    },

    hide() {
      root.style.display = 'none';
    },
  };
}
