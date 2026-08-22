import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RebuildStatus } from '@/state/stores/progress';

import { SourceKind } from '@/utils/sources';
import { ScanPhase, CloneStage } from '@/api/manifest';
import {
  LoadingStep,
  BuildStage,
  BUILD_ONLY_STEPS,
  TIMELINE_LOADING_STEPS,
} from '@/constants/progress';
import { EMPTY_MANIFEST } from '../../_helpers/manifestFixtures';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

describe('loadingReactions', () => {
  let dispose: () => void;
  beforeEach(() => {
    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    session.progress.builtManifest.value = null;
    dispose = session.progress.attachOverlayDriver();
  });
  afterEach(() => {
    dispose();
    session.progress.scan.value = null;
    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    session.progress.builtManifest.value = null;
    session.progress.buildProgress.value = null;
    // Visibility is per attach, so one left up is invisible to the next test.
    session.progress.overlay.value = {
      visible: false,
      showOpts: null,
      activeStep: null,
      stepTails: {},
    };
  });

  // Structure, then per-file metadata, then git history: three cities, and the
  // last is the one with trees. The overlay covers all three or it lies.

  it('keeps the overlay up while per-file metadata is still pending', () => {
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    expect(session.progress.overlay.value.visible).toBe(true);
  });

  it('stays up through the git walk, whose city is the one with trees in it', () => {
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    expect(session.progress.overlay.value.visible).toBe(true);
    // The metadata manifest applies: real heights paint, then land…
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };
    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    // …and the overlay stays: history is still coming, and it brings the trees.
    expect(session.progress.overlay.value.visible, 'history still streaming').toBe(true);
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.History);

    // The final manifest applies, and only its painted frame ends the load.
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    session.progress.scan.value = null;
    expect(session.progress.overlay.value.visible, 'final city still building').toBe(true);
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);

    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  it('a new load shows the overlay even though the previous repo finished', () => {
    // First load runs to completion…
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };
    session.progress.scan.value = null;
    // …then a second load starts. Nothing of it is applied yet, so no
    // appliedPending — the finished previous manifest must not leak in.
    session.progress.scan.value = { kind: SourceKind.Remote, phase: null };
    expect(session.progress.overlay.value.visible).toBe(true);
  });

  it('shows the overlay immediately on a just-started (phase null) load', () => {
    session.progress.scan.value = { kind: SourceKind.Remote, phase: null };
    expect(session.progress.overlay.value.visible).toBe(true);
    // git initial step is Resolving (set by showLoadingOverlay), not overridden
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Resolving);
  });

  it('local just-started shows the Scanning initial step', () => {
    session.progress.scan.value = { kind: SourceKind.Local, phase: null };
    expect(session.progress.overlay.value.visible).toBe(true);
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Scanning);
  });

  it('advances the step to Sketching layout on the skeleton phase', () => {
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.PartialManifest };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Skeleton);
  });

  it('sets a cloning tail from percent/stage', () => {
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.CloneProgress,
      percent: 45,
      stage: CloneStage.Receiving,
    };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Cloning);
    expect(session.progress.overlay.value.stepTails[LoadingStep.Cloning]).toContain('45%');
  });

  it('hides the overlay when progress clears', () => {
    session.progress.scan.value = { kind: SourceKind.Local, phase: ScanPhase.ScanProgress };
    session.progress.scan.value = null;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  it('holds the overlay after the stream ends while the city is still building', () => {
    // Stream in progress → overlay shows.
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    // City build kicked off (applyManifest → layoutCity) BEFORE the stream's
    // finally clears progress.
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = null;
    // Overlay stays up (would otherwise flash an empty 3D world), on Building.
    expect(session.progress.overlay.value.visible).toBe(true);
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);

    // Decorating lands before the layout is published, so the overlay stays.
    session.progress.rebuildStatus.value = RebuildStatus.Decorating;
    expect(session.progress.overlay.value.visible).toBe(true);

    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  it('holds the overlay through Decorating, which lands before the city exists', () => {
    // markDecorating runs BEFORE applyStructure publishes the layout, so the
    // city does not exist during it. Idle is what means "on screen" now.
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = null;
    expect(session.progress.overlay.value.visible).toBe(true);

    session.progress.rebuildStatus.value = RebuildStatus.Decorating;
    expect(session.progress.overlay.value.visible).toBe(true);
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);

    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  it('lets the overlay go when the build errored', () => {
    // Nothing will ever paint, so holding for a frame would strand it.
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = null;
    expect(session.progress.overlay.value.visible).toBe(true);

    session.progress.rebuildStatus.value = RebuildStatus.Error;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  it('keeps the repo name up for the whole overlay, not just the stream', () => {
    // The stream ends well before the city is assembled, so clearing the label
    // with the stream blanked the header while Building was still on screen.
    session.progress.pendingLabel.value = 'owner/repo';
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = null;

    expect(session.progress.overlay.value.visible, 'still building').toBe(true);
    expect(session.progress.pendingLabel.value, 'header must survive the build phase').toBe(
      'owner/repo'
    );

    // Decorating is still building; the label clears with the overlay.
    session.progress.rebuildStatus.value = RebuildStatus.Decorating;
    expect(session.progress.overlay.value.visible).toBe(true);

    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    expect(session.progress.overlay.value.visible).toBe(false);
    expect(session.progress.pendingLabel.value, 'and clear with the overlay').toBeNull();
  });

  // Sketching layout owns the skeleton AND the city drawn from it; Building
  // city is the real heights going up. The list only ever moves forward.

  it('stays on Sketching layout while the skeleton city is being built', () => {
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding; // the skeleton's own pack

    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Skeleton);
  });

  it('moves to Reading history when the real heights land', () => {
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['history'],
    };

    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.History);
  });

  it('never walks the list backwards inside one load', () => {
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);

    // Re-lighting a row already passed reads as the load starting again.
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.PartialManifest,
      appliedPending: ['metadata', 'history'],
    };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);

    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.ScanProgress };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);
  });

  it('starts the list over for a genuinely new load', () => {
    session.progress.scan.value = { kind: SourceKind.Remote, phase: ScanPhase.CompleteManifest };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);

    // A new load announces itself with a phase-less first event.
    session.progress.scan.value = { kind: SourceKind.Remote, phase: null };
    session.progress.scan.value = {
      kind: SourceKind.Remote,
      phase: ScanPhase.CloneProgress,
      percent: 10,
    };
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Cloning);
  });

  it('does NOT show the overlay for a rebuild under a city already up', () => {
    // A config Save sets Rebuilding with no SCAN_PROGRESS. There is a city on
    // screen throughout, so the footer owns that status, not the overlay.
    session.progress.builtManifest.value = EMPTY_MANIFEST;
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  // Re-opening the project you were just in never streams, but leaving /city
  // threw the canvas away: that rebuild is the whole wait, so it gets the overlay.

  it('shows the overlay for a build with nothing on screen behind it', () => {
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;

    expect(session.progress.overlay.value.visible).toBe(true);
    expect(session.progress.overlay.value.activeStep).toBe(LoadingStep.Building);
    // Nothing was fetched, so the fetch rows would be rows for work nobody did.
    expect(session.progress.overlay.value.showOpts?.steps).toEqual(BUILD_ONLY_STEPS);

    session.progress.rebuildStatus.value = RebuildStatus.Idle;
    expect(session.progress.overlay.value.visible).toBe(false);
  });

  it('leaves an overlay someone else raised alone', () => {
    // Timeline shows its own list before its build starts; adopting it would
    // swap the rows out from under the load driving them.
    session.progress.showOverlay({ kind: SourceKind.Remote, steps: TIMELINE_LOADING_STEPS });
    session.progress.rebuildStatus.value = RebuildStatus.Rebuilding;

    expect(session.progress.overlay.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);
  });

  it('has no city on screen once the canvas goes away', () => {
    session.progress.markIdle();
    session.progress.builtManifest.value = EMPTY_MANIFEST; // markIdle copies MANIFEST, empty here
    expect(session.progress.cityOnScreen.value).toBe(true);

    session.progress.markGone();
    expect(session.progress.cityOnScreen.value).toBe(false);
    expect(session.progress.rebuildStatus.value).toBe(RebuildStatus.Pending);
  });

  // The build's stages go to the overlay's row and nowhere else. They pass in a
  // few frames, and the freshness readout flickering through them was noise.

  it('puts the build stage on the Building row', () => {
    session.progress.beginBuild([BuildStage.Layout, BuildStage.Assemble]);

    expect(session.progress.overlay.value.stepTails[LoadingStep.Building]).toBe('0% layout');
  });

  it('follows the build the whole way down the row', () => {
    session.progress.beginBuild([BuildStage.Layout, BuildStage.Assemble]);
    session.progress.setBuildStagePercent(30);
    expect(session.progress.overlay.value.stepTails[LoadingStep.Building]).toBe('15% layout');

    session.progress.enterBuildStage(BuildStage.Assemble);
    expect(session.progress.overlay.value.stepTails[LoadingStep.Building]).toBe('50% buildings');
  });

  it('carries on into the decoration pass rather than going blank', () => {
    // Timeline's overlay outlives the pack, so a row cleared here sits empty
    // through the tree pass and the scrub install: the wait that needed it.
    session.progress.beginBuild([BuildStage.Layout, BuildStage.Assemble, BuildStage.Decorate]);
    session.progress.markDecorating();

    expect(session.progress.overlay.value.stepTails[LoadingStep.Building]).toBe('67% trees');
  });

  // The readout beside the dot says "rebuilding…" and nothing else; only a
  // build with no overlay to report it (Timeline's refetch) writes that detail.
  it('leaves the freshness detail alone through a build', () => {
    session.progress.beginBuild([BuildStage.Layout, BuildStage.Assemble]);
    expect(session.progress.detail.value).toBeNull();

    session.progress.setBuildStagePercent(30);
    session.progress.enterBuildStage(BuildStage.Assemble);
    session.progress.markDecorating();
    expect(session.progress.detail.value).toBeNull();
  });

  it('clears the row when the build finishes', () => {
    session.progress.beginBuild([BuildStage.Layout, BuildStage.Assemble]);
    session.progress.markIdle();

    expect(session.progress.buildProgress.value).toBeNull();
    expect(session.progress.overlay.value.stepTails[LoadingStep.Building]).toBeNull();
  });
});
