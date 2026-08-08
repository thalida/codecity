// state/loadingReactions.ts — Maps the canonical SCAN_PROGRESS signal to the
// LOADING_OVERLAY store. Mounted once from <App />. Replaces the fetch layer's
// direct overlay pokes — the fetch layer now only writes SCAN_PROGRESS. The
// "loading {project}" header is owned separately by PENDING_SOURCE_LABEL (set by
// the stream pump, read directly by LoadingOverlay) — NOT set here.

import { effect } from '@preact/signals';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { MANIFEST, REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import { hasResolvedMetadata } from '@/utils/manifest';
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingStep,
  setLoadingStepTail,
} from '@/state/stores/ui';
import { ScanPhase } from '@/api/manifest';
import { LoadingStep, stepForPhase } from '@/constants/loadingSteps';

export function attachLoadingReactions(): () => void {
  let wasActive = false;
  // Latched per load: once the city is on screen the overlay must not come
  // back, and the history stage that follows keeps ticking SCAN_PROGRESS.
  let revealed = false;
  return effect(() => {
    const p = SCAN_PROGRESS.value;
    const metadataResolved = hasResolvedMetadata(MANIFEST.value);
    // The stream finishing (p === null) does NOT mean the city is on screen:
    // setManifest only KICKS OFF applyManifest, whose layoutCity runs async for
    // a second-plus on a big repo. Hold the overlay through that build (status
    // stays Rebuilding until the city renders) so we never flash an empty 3D
    // world between "stream done" and "city painted".
    const building = REBUILD_STATUS.value === RebuildStatus.Rebuilding;
    if (!p) {
      if (building) {
        // Stream done, city still assembling — keep the overlay on "Building".
        if (wasActive) setLoadingStep(LoadingStep.Building);
        return;
      }
      if (wasActive) hideLoadingOverlay();
      wasActive = false;
      revealed = false;
      return;
    }
    // The buildings are final once metadata has landed and painted; git history
    // is still streaming behind this, and it only adds trees and the timeline.
    // Waiting for it would hold a finished city behind the overlay for minutes.
    if (revealed) return;
    if (metadataResolved && !building) {
      revealed = true;
      if (wasActive) hideLoadingOverlay();
      wasActive = false;
      return;
    }
    if (!wasActive) {
      // null→non-null: show the overlay at the kind-based initial step
      // (Resolving for git, Scanning for local).
      showLoadingOverlay({ kind: p.kind, branch: p.branch });
      wasActive = true;
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
