// loadingOverlay.ts — Centered spinner + stepped progress indicator shown
// whenever a manifest is being fetched or applied. Reused for direct-boot
// loads and modal submits so the user sees the same UI regardless of entry
// point.
//
// API:
//   show({ kind, label, branch? }) — display overlay; starts heuristic timer
//   setStep(step)                  — explicit step override (caller calls
//                                    setStep('building') when fetch returns)
//   hide()                         — dismiss overlay; clears timers

export type LoadingStep = 'resolving' | 'cloning' | 'scanning' | 'building';

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

// Steps in display order.
const ALL_STEPS: LoadingStep[] = ['resolving', 'cloning', 'scanning', 'building'];

// Human-readable label for each step.
const STEP_LABELS: Record<LoadingStep, string> = {
  resolving: 'Resolving source',
  cloning: 'Cloning',
  scanning: 'Scanning files',
  building: 'Building city',
};

// Heuristic timer thresholds (ms) for git mode auto-advance.
// 0s  → resolving active
// 2s  → cloning active
// 10s → scanning active
// (building is only triggered by an explicit setStep call from the caller)
const GIT_THRESHOLDS: Array<{ ms: number; step: LoadingStep }> = [
  { ms: 2_000, step: 'cloning' },
  { ms: 10_000, step: 'scanning' },
];

export function createLoadingOverlay(): LoadingOverlay {
  const root = document.getElementById('loading-overlay-root');
  if (!root) {
    return {
      show: () => {},
      setStep: () => {},
      hide: () => {},
    };
  }

  let _kind: 'git' | 'local' = 'local';
  let _startMs = 0;
  let _timerIds: number[] = [];
  let _elapsedTimer: number | null = null;
  let _currentStep: LoadingStep = 'scanning';

  // DOM refs — populated on first show().
  let _titleEl: HTMLElement | null = null;
  let _elapsedEl: HTMLElement | null = null;
  let _stepEls: Partial<Record<LoadingStep, HTMLElement>> = {};

  function _buildDOM(): void {
    root.innerHTML = `
      <div class="loading-backdrop">
        <div class="loading-card">
          <div class="loading-spinner"></div>
          <div class="loading-title" role="status" aria-live="polite"></div>
          <ol class="loading-steps">
            <li data-step="resolving" data-state="pending">${STEP_LABELS.resolving}</li>
            <li data-step="cloning"   data-state="pending">${STEP_LABELS.cloning}</li>
            <li data-step="scanning"  data-state="pending">${STEP_LABELS.scanning}</li>
            <li data-step="building"  data-state="pending">${STEP_LABELS.building}</li>
          </ol>
          <div class="loading-elapsed">0s</div>
        </div>
      </div>
    `;

    _titleEl   = root.querySelector('.loading-title');
    _elapsedEl = root.querySelector('.loading-elapsed');
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
    _currentStep = step;
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

  function _formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
  }

  function _startElapsedTick(): void {
    if (_elapsedTimer != null) return;
    _elapsedTimer = window.setInterval(() => {
      if (_elapsedEl) {
        _elapsedEl.textContent = _formatElapsed(Date.now() - _startMs);
      }
    }, 1_000);
  }

  function _clearTimers(): void {
    for (const id of _timerIds) window.clearTimeout(id);
    _timerIds = [];
    if (_elapsedTimer != null) {
      window.clearInterval(_elapsedTimer);
      _elapsedTimer = null;
    }
  }

  function _scheduleGitHeuristics(): void {
    for (const { ms, step } of GIT_THRESHOLDS) {
      const id = window.setTimeout(() => {
        // Only auto-advance if we're still on an earlier step (don't
        // override an explicit setStep('building') call).
        const currentIdx = ALL_STEPS.indexOf(_currentStep);
        const targetIdx  = ALL_STEPS.indexOf(step);
        if (targetIdx > currentIdx) {
          _applyStep(step);
        }
      }, ms);
      _timerIds.push(id);
    }
  }

  return {
    show({ kind, label, branch }: LoadingOverlayShowOpts) {
      _clearTimers();
      _kind = kind;
      _startMs = Date.now();

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
        _applyStep('resolving');
        _scheduleGitHeuristics();
      }

      if (_elapsedEl) _elapsedEl.textContent = '0s';
      root.style.display = 'block';
      _startElapsedTick();
    },

    setStep(step: LoadingStep) {
      _applyStep(step);
    },

    hide() {
      _clearTimers();
      root.style.display = 'none';
    },
  };
}
