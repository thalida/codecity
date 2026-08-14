// state/loadingReactions.ts — Maps the canonical progress signals to the
// LOADING_OVERLAY store: SCAN_PROGRESS for the stream's rows, BUILD_PROGRESS for
// what runs inside the last one. Mounted once from <App />. Replaces the fetch
// layer's direct overlay pokes — the fetch layer now only writes SCAN_PROGRESS.
// The "loading {project}" header is owned separately by PENDING_SOURCE_LABEL (set
// by the stream pump, read directly by LoadingOverlay) — NOT set here.

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
import { LoadingStep, stepForPhase } from '@/constants/loadingSteps';
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
  return effect(() => {
    const p = SCAN_PROGRESS.value;
    // The stream finishing (p === null) does NOT mean the city is on screen:
    // setManifest only KICKS OFF applyManifest, whose layoutCity runs async for
    // a second-plus on a big repo. Hold the overlay through that build (status
    // stays Rebuilding until the city renders) so we never flash an empty 3D
    // world between "stream done" and "city painted".
    const building = REBUILD_STATUS.value === RebuildStatus.Rebuilding;
    const hide = () => {
      if (overlayUp) hideLoadingOverlay();
      overlayUp = false;
    };
    if (!p) {
      if (building) {
        // Stream done, city still assembling — keep the overlay on "Building".
        if (overlayUp) setLoadingStep(LoadingStep.Building);
        return;
      }
      hide();
      return;
    }
    // The applied manifest has real building heights (its `pending` no longer
    // lists metadata) — the scan behind it is only git history now, which adds
    // trees and the timeline to an already-correct city. Lift the overlay as
    // soon as that city's paint lands and stay out of the way after.
    if (p.appliedPending && !p.appliedPending.includes('metadata')) {
      if (!building) hide();
      return;
    }
    if (!overlayUp) {
      // null→non-null: show the overlay at the kind-based initial step
      // (Resolving for git, Scanning for local).
      showLoadingOverlay({ kind: p.kind, branch: p.branch });
      overlayUp = true;
    }
    setLoadingStep(stepForPhase(p.phase, p.kind));
    if (p.phase === ScanPhase.CloneProgress) {
      // A normal tick shows "{percent}% ({stage})"; a heartbeat during the
      // silent promisor blob fetch (no percent) shows the working tree growing
      // on disk so the step doesn't look frozen.
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
