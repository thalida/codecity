import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachLoadingReactions } from '@/state/loadingReactions';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { LOADING_OVERLAY } from '@/state/stores/ui';
import { SourceKind } from '@/utils/sources';
import { ScanPhase } from '@/api/manifest';
import { LoadingStep } from '@/constants/loadingSteps';

describe('loadingReactions', () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose = attachLoadingReactions();
  });
  afterEach(() => {
    dispose();
    SCAN_PROGRESS.value = null;
  });

  it('shows the overlay immediately on a just-started (phase null) load', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Git, label: 'r', phase: null };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    // git initial step is Resolving (set by showLoadingOverlay), not overridden
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Resolving);
  });

  it('local just-started shows the Scanning initial step', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Local, label: 'proj', phase: null };
    expect(LOADING_OVERLAY.value.visible).toBe(true);
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Scanning);
  });

  it('advances the step to Building on the skeleton phase', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Git, label: 'r', phase: ScanPhase.Skeleton };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Skeleton);
  });

  it('sets a cloning tail from percent/stage', () => {
    SCAN_PROGRESS.value = {
      kind: SourceKind.Git,
      label: 'r',
      phase: ScanPhase.Cloning,
      percent: 45,
      stage: 'Receiving',
    };
    expect(LOADING_OVERLAY.value.activeStep).toBe(LoadingStep.Cloning);
    expect(LOADING_OVERLAY.value.stepTails[LoadingStep.Cloning]).toContain('45%');
  });

  it('hides the overlay when progress clears', () => {
    SCAN_PROGRESS.value = { kind: SourceKind.Local, label: 'proj', phase: ScanPhase.Scanning };
    SCAN_PROGRESS.value = null;
    expect(LOADING_OVERLAY.value.visible).toBe(false);
  });
});
