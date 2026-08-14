// state/loadingReactions.ts — Maps the canonical progress signals to the
// LOADING_OVERLAY store: SCAN_PROGRESS for the stream's rows, BUILD_PROGRESS for
// what runs inside the last one. Mounted once from <App />. The overlay's header
// is owned separately by PENDING_SOURCE_LABEL, NOT set here.

import { effect } from '@preact/signals';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import {
  BUILD_PROGRESS,
  REBUILD_STATUS,
  RebuildStatus,
  setRebuildDetail,
} from '@/state/stores/manifest';
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
} from '@/state/stores/ui';
import { ScanPhase } from '@/api/manifest';
import { LoadingStep, LOADING_STEPS, firstStepFor, stepForPhase } from '@/constants/loadingSteps';
import { buildStageTail } from '@/constants/buildStages';

export function attachLoadingReactions(): () => void {
  const stops = [attachScanReaction(), attachBuildReaction()];
  return () => stops.forEach((stop) => stop());
}

// The build's stage tail onto BOTH surfaces that report a build — the overlay's
// row and the inline freshness readout — so the two can never drift apart.
function attachBuildReaction(): () => void {
  return effect(() => {
    const tail = buildStageTail(BUILD_PROGRESS.value);
    setLoadingStepTail(LoadingStep.Building, tail);
    setRebuildDetail(tail);
  });
}

function attachScanReaction(): () => void {
  let overlayUp = false;
  // How far down the list this load has got. A row that lights up again after a
  // later one reads as the whole load starting over.
  let reached = -1;
  const advance = (step: LoadingStep): void => {
    if (!overlayUp) return;
    const index = LOADING_STEPS.indexOf(step);
    if (index <= reached) return;
    reached = index;
    setLoadingStep(step);
  };
  return effect(() => {
    const p = SCAN_PROGRESS.value;
    // The stream finishing (p === null) does NOT mean the city is on screen:
    // hold the overlay through the build, or an empty 3D world flashes.
    const building = REBUILD_STATUS.value === RebuildStatus.Rebuilding;
    const hide = () => {
      if (overlayUp) hideLoadingOverlay();
      overlayUp = false;
    };
    if (!p) {
      if (building) {
        // Stream done, city still assembling — keep the overlay on "Building".
        advance(LoadingStep.Building);
        return;
      }
      hide();
      return;
    }
    // A load's first event: a new list, so it starts from the top again.
    if (p.phase === null) reached = -1;
    // The skeleton's own build belongs to Sketching layout: placeholder heights
    // are what that row draws. Building city is the real ones going up.
    const sketching = p.appliedPending?.includes('metadata') ?? false;
    if (p.appliedPending && !sketching) {
      // Real heights: only git history is still streaming, and it adds trees to
      // an already-correct city. Lift as soon as that paint lands.
      if (!building) {
        hide();
        return;
      }
      advance(LoadingStep.Building);
      return;
    }
    if (!overlayUp) {
      // null→non-null: show the overlay at the kind-based initial step
      // (Resolving for git, Scanning for local).
      showLoadingOverlay({ kind: p.kind, branch: p.branch });
      overlayUp = true;
      reached = LOADING_STEPS.indexOf(firstStepFor(LOADING_STEPS, p.kind));
    }
    advance(stepForPhase(p.phase, p.kind));
    if (p.phase === ScanPhase.CloneProgress) {
      // A normal tick shows "{percent}% ({stage})"; a heartbeat during the
      // silent promisor blob fetch shows the working tree growing on disk.
      let tail: string | null = null;
      if (p.percent !== undefined) {
        tail = `${p.percent}%${p.stage ? ` (${p.stage})` : ''}`;
      } else if (p.mbOnDisk !== undefined) {
        tail = `${p.mbOnDisk} MB`;
      }
      setLoadingStepTail(LoadingStep.Cloning, tail);
    } else if (p.phase === ScanPhase.ScanProgress) {
      setLoadingStepTail(
        LoadingStep.Scanning,
        p.filesScanned !== undefined ? `${p.filesScanned.toLocaleString()} files` : null
      );
    } else if (p.phase === ScanPhase.PartialManifest || p.phase === ScanPhase.CompleteManifest) {
      // Progress tails done.
      setLoadingStepTail(LoadingStep.Cloning, null);
      setLoadingStepTail(LoadingStep.Scanning, null);
    }
    // p.phase === null: just-started; showLoadingOverlay already set the
    // kind-based initial step — nothing more to do until a real event.
  });
}
