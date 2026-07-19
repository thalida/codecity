import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachLoadingReactions } from '@/state/loadingReactions';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import { LOADING_OVERLAY } from '@/state/stores/ui';
import { SourceKind } from '@/utils/sources';
import { ScanPhase, CloneStage } from '@/api/manifest';
import { LoadingStep } from '@/constants/loadingSteps';

describe('loadingReactions', () => {
  let dispose: () => void;
  beforeEach(() => {
    REBUILD_STATUS.value = RebuildStatus.Idle;
    dispose = attachLoadingReactions();
  });
  afterEach(() => {
    dispose();
    SCAN_PROGRESS.value = null;
    REBUILD_STATUS.value = RebuildStatus.Idle;
  });

  it('shows the overlay immediately on a just-started (phase null) load', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: null };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    // git initial step is Resolving (set by showLoadingOverlay), not overridden
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Resolving);
  });

  it('local just-started shows the Scanning initial step', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Local, phase: null };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Scanning);
  });

  it('advances the step to Building on the skeleton phase', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.PartialManifest };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Skeleton);
  });

  it('sets a cloning tail from percent/stage', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.CloneProgress,
      percent: 45,
      stage: CloneStage.Receiving,
    };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Cloning);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Cloning]).toContain('45%');
  });

  it('hides the overlay when progress clears', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Local, phase: ScanPhase.ScanProgress };
    SCAN_PROGRESS.value = null;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('holds the overlay after the stream ends while the city is still building', () => {
    // Stream in progress → overlay shows.
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    // City build kicked off (applyManifest → layoutCity) BEFORE the stream's
    // finally clears progress.
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = null;
    // Overlay stays up (would otherwise flash an empty 3D world), on Building.
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    // City painted → status leaves Rebuilding → overlay hides.
    REBUILD_STATUS.value = RebuildStatus.Decorating;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('does NOT show the overlay for a settings rebuild (no stream)', () => {
    // A config Save sets Rebuilding with no SCAN_PROGRESS — the footer owns that
    // status, not the loading overlay.
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });
});
