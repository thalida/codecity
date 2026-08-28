import { CloneStage, ScanPhase } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  attachOverlayDriver,
  SCAN_PROGRESS,
  REBUILD_STATUS,
  RebuildStatus,
  REBUILD_DETAIL,
  BUILD_PROGRESS,
  beginBuild,
  enterBuildStage,
  setBuildStagePercent,
  markDecorating,
  markIdle,
  LOADING_OVERLAY,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/progress';

import { SourceKind } from '@/utils/sources';
import { LoadingStep, BuildStage } from '@/constants/progress';

describe('loadingReactions', () => {
  let dispose: () => void;
  beforeEach(() => {
    REBUILD_STATUS.value = RebuildStatus.Idle;
    dispose = attachOverlayDriver();
  });
  afterEach(() => {
    dispose();
    SCAN_PROGRESS.value = null;
    REBUILD_STATUS.value = RebuildStatus.Idle;
    BUILD_PROGRESS.value = null;
    // Visibility is per attach, so one left up is invisible to the next test.
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
  });

  // The scan streams structure, then per-file metadata, then git history. History
  // is minutes and only feeds decorations, so the overlay lifts at metadata.

  it('keeps the overlay up while per-file metadata is still pending', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
  });

  it('reveals the city once metadata has landed, with history still streaming', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    // The metadata manifest applies: painting starts, then lands.
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };
    expect(LOADING_OVERLAY.value.visible).toBe(true); // still painting
    REBUILD_STATUS.value = RebuildStatus.Idle;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('does not re-show the overlay while history streams behind the live city', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    // The final apply repaints (Rebuilding) — the overlay must not return.
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.CompleteManifest,
      appliedPending: ['history'],
    };
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('a new load shows the overlay even though the previous repo finished', () => {
    // First load runs to completion…
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };
    SCAN_PROGRESS.value = null;
    // …then a second load starts. Nothing of it is applied yet, so no
    // appliedPending — the finished previous manifest must not leak in.
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: null };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
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

    // Decorating lands before the layout is published, so the overlay stays.
    REBUILD_STATUS.value = RebuildStatus.Decorating;
    expect(LOADING_OVERLAY.value.visible).toBe(true);

    REBUILD_STATUS.value = RebuildStatus.Idle;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('holds the overlay through Decorating, which lands before the city exists', () => {
    // markDecorating runs BEFORE applyStructure publishes the layout, so the
    // city does not exist during it. Idle is what means "on screen" now.
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = null;
    expect(LOADING_OVERLAY.value.visible).toBe(true);

    REBUILD_STATUS.value = RebuildStatus.Decorating;
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    REBUILD_STATUS.value = RebuildStatus.Idle;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('lets the overlay go when the build errored', () => {
    // Nothing will ever paint, so holding for a frame would strand it.
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = null;
    expect(LOADING_OVERLAY.value.visible).toBe(true);

    REBUILD_STATUS.value = RebuildStatus.Error;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  it('keeps the repo name up for the whole overlay, not just the stream', () => {
    // The stream ends well before the city is assembled, so clearing the label
    // with the stream blanked the header while Building was still on screen.
    PENDING_SOURCE_LABEL.value = 'owner/repo';
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = null;

    expect(LOADING_OVERLAY.value.visible, 'still building').toBe(true);
    expect(PENDING_SOURCE_LABEL.value, 'header must survive the build phase').toBe('owner/repo');

    // Decorating is still building; the label clears with the overlay.
    REBUILD_STATUS.value = RebuildStatus.Decorating;
    expect(LOADING_OVERLAY.value.visible).toBe(true);

    REBUILD_STATUS.value = RebuildStatus.Idle;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
    expect(PENDING_SOURCE_LABEL.value, 'and clear with the overlay').toBeNull();
  });

  // Sketching layout owns the skeleton AND the city drawn from it; Building
  // city is the real heights going up. The list only ever moves forward.

  it('stays on Sketching layout while the skeleton city is being built', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    REBUILD_STATUS.value = RebuildStatus.Rebuilding; // the skeleton's own pack

    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Skeleton);
  });

  it('moves to Building city when the real heights land', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };

    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
  });

  it('never walks the list backwards inside one load', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    // Re-lighting a row already passed reads as the load starting again.
    SCAN_PROGRESS.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.ScanProgress };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);
  });

  it('starts the list over for a genuinely new load', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Building);

    // A new load announces itself with a phase-less first event.
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: null };
    SCAN_PROGRESS.value = { kind: SourceKind.Remote, phase: ScanPhase.CloneProgress, percent: 10 };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Cloning);
  });

  it('does NOT show the overlay for a settings rebuild (no stream)', () => {
    // A config Save sets Rebuilding with no SCAN_PROGRESS — the footer owns that
    // status, not the loading overlay.
    REBUILD_STATUS.value = RebuildStatus.Rebuilding;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });

  // The build's stages go to the overlay's row and nowhere else. They pass in a
  // few frames, and the freshness readout flickering through them was noise.

  it('puts the build stage on the Building row', () => {
    beginBuild([BuildStage.Layout, BuildStage.Assemble]);

    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Building]).toBe('0% layout');
  });

  it('follows the build the whole way down the row', () => {
    beginBuild([BuildStage.Layout, BuildStage.Assemble]);
    setBuildStagePercent(30);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Building]).toBe('15% layout');

    enterBuildStage(BuildStage.Assemble);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Building]).toBe('50% buildings');
  });

  it('carries on into the decoration pass rather than going blank', () => {
    // Timeline's overlay outlives the pack, so a row cleared here sits empty
    // through the tree pass and the scrub install: the wait that needed it.
    beginBuild([BuildStage.Layout, BuildStage.Assemble, BuildStage.Decorate]);
    markDecorating();

    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Building]).toBe('67% trees');
  });

  // The readout beside the dot says "rebuilding…" and nothing else; only a
  // build with no overlay to report it (Timeline's refetch) writes that detail.
  it('leaves the freshness detail alone through a build', () => {
    beginBuild([BuildStage.Layout, BuildStage.Assemble]);
    expect(REBUILD_DETAIL.value).toBeNull();

    setBuildStagePercent(30);
    enterBuildStage(BuildStage.Assemble);
    markDecorating();
    expect(REBUILD_DETAIL.value).toBeNull();
  });

  it('clears the row when the build finishes', () => {
    beginBuild([BuildStage.Layout, BuildStage.Assemble]);
    markIdle();

    expect(BUILD_PROGRESS.value).toBeNull();
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Building]).toBeNull();
  });
});
