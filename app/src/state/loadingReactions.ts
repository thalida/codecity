// state/loadingReactions.ts — Maps the canonical SCAN_PROGRESS signal to the
// LOADING_OVERLAY store. Mounted once from <App />. Replaces the fetch layer's
// direct overlay pokes — the fetch layer now only writes SCAN_PROGRESS. The
// "loading {project}" header is owned separately by PENDING_SOURCE_LABEL (set by
// the stream pump, read directly by LoadingOverlay) — NOT set here.

import { effect } from '@preact/signals';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
} from '@/state/stores/ui';
import { ScanPhase } from '@/api/manifest';
import { LoadingStep } from '@/constants/loadingSteps';

export function attachLoadingReactions(): () => void {
  let wasActive = false;
  return effect(() => {
    const p = SCAN_PROGRESS.value;
    if (!p) {
      if (wasActive) hideLoadingOverlay();
      wasActive = false;
      return;
    }
    if (!wasActive) {
      // null→non-null: show the overlay at the kind-based initial step
      // (Resolving for git, Scanning for local).
      showLoadingOverlay({ kind: p.kind, label: p.label, branch: p.branch });
      wasActive = true;
    }
    if (p.phase === ScanPhase.Cloning) {
      setLoadingStep(LoadingStep.Cloning);
      setLoadingStepTail(
        LoadingStep.Cloning,
        p.percent !== undefined ? `${p.percent}%${p.stage ? ` (${p.stage})` : ''}` : null
      );
    } else if (p.phase === ScanPhase.Scanning) {
      setLoadingStep(LoadingStep.Scanning);
      setLoadingStepTail(
        LoadingStep.Scanning,
        p.filesScanned !== undefined ? `${p.filesScanned.toLocaleString()} files` : null
      );
    } else if (p.phase === ScanPhase.Skeleton || p.phase === ScanPhase.Final) {
      // Progress tails done.
      setLoadingStepTail(LoadingStep.Cloning, null);
      setLoadingStepTail(LoadingStep.Scanning, null);
      setLoadingStep(p.phase === ScanPhase.Skeleton ? LoadingStep.Skeleton : LoadingStep.Building);
    }
    // p.phase === null: just-started; showLoadingOverlay already set the
    // kind-based initial step — nothing more to do until a real event.
  });
}
