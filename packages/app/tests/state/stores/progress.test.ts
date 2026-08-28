// The overlay above the scene city. Everything it draws comes from ONE value —
// the city's own status — plus the one thing the app knows first: that it asked
// for a source at all. There is no second account of what is happening here to
// keep in step, which is what this file used to be full of.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BuildStage, CityLifecycle, CityPhase, EMPTY_CITY_STATUS } from '@codecity/city';
import type { CityStatus } from '@codecity/city';
import {
  attachOverlayDriver,
  CITY_STATUS,
  LOADING_SOURCE,
  REBUILD_DETAIL,
  LOADING_OVERLAY,
  PENDING_SOURCE_LABEL,
} from '@/state/stores/progress';

import { SourceKind } from '@/utils/sources';
import { LoadingStep } from '@/constants/progress';

/** Put the city in a state, the way its own status would report it. */
function say(status: Partial<CityStatus>): void {
  CITY_STATUS.value = { ...EMPTY_CITY_STATUS, ...status };
}

/** A load this app asked for, before the city has reported anything. */
const asked = (kind = SourceKind.Remote, branch?: string) => {
  LOADING_SOURCE.value = { kind, branch };
};

const visible = () => LOADING_OVERLAY.value.visible;
const step = () => LOADING_OVERLAY.value.activeStep;
const tail = (row: LoadingStep) => LOADING_OVERLAY.value.stepTails[row];

describe('the loading overlay', () => {
  let dispose: () => void;

  beforeEach(() => {
    CITY_STATUS.value = EMPTY_CITY_STATUS;
    LOADING_SOURCE.value = null;
    PENDING_SOURCE_LABEL.value = null;
    dispose = attachOverlayDriver();
  });

  afterEach(() => {
    dispose();
    CITY_STATUS.value = EMPTY_CITY_STATUS;
    LOADING_SOURCE.value = null;
    // Visibility is per attach, so one left up is invisible to the next test.
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
  });

  describe('when it is up', () => {
    it('shows as soon as a source is asked for, before the city has spoken', () => {
      asked();
      expect(visible()).toBe(true);
      expect(step()).toBe(CityPhase.Resolving);
    });

    it('opens on Scanning for a local path, which has nothing to resolve', () => {
      asked(SourceKind.Local);
      expect(step()).toBe(CityPhase.Scanning);
    });

    it('follows the city down the list', () => {
      asked();
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Cloning, fetching: true });
      expect(step()).toBe(CityPhase.Cloning);
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Sketching, fetching: true });
      expect(step()).toBe(CityPhase.Sketching);
    });

    // The scan streams more than once: history is where commits come from, and
    // commits are the trees, so a city revealed here grows a forest.
    it('stays up for a city on screen that is not the final one', () => {
      asked();
      say({ lifecycle: CityLifecycle.Ready, fetching: true });
      LOADING_SOURCE.value = null; // the stream has ended
      expect(visible()).toBe(true);
    });

    it('stays up through the last build after the stream has ended', () => {
      asked();
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      LOADING_SOURCE.value = null;
      expect(visible()).toBe(true);
    });
  });

  describe('when it comes down', () => {
    it('goes once the city on screen says nothing is left to come', () => {
      asked();
      say({ lifecycle: CityLifecycle.Ready, fetching: true });
      expect(visible()).toBe(true);

      say({ lifecycle: CityLifecycle.Ready, fetching: false });
      LOADING_SOURCE.value = null;
      expect(visible()).toBe(false);
    });

    it('goes when the build errored, since no frame is coming', () => {
      asked();
      say({ lifecycle: CityLifecycle.Error, error: new Error('no such repo') });
      LOADING_SOURCE.value = null;
      expect(visible()).toBe(false);
    });

    // A Save re-packs the city behind an overlay nobody asked for otherwise.
    it('does not appear for a rebuild with no source asked for', () => {
      say({ lifecycle: CityLifecycle.Ready, phase: CityPhase.Building, fetching: false });
      expect(visible()).toBe(false);
    });
  });

  describe('the list of rows', () => {
    it('never walks backwards inside one load', () => {
      asked();
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      expect(step()).toBe(CityPhase.Building);

      // Re-lighting a row already passed reads as the load starting again.
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Scanning, fetching: true });
      expect(step()).toBe(CityPhase.Building);
    });

    it('starts over for a genuinely new load', () => {
      asked();
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      say({ lifecycle: CityLifecycle.Ready, fetching: false });
      LOADING_SOURCE.value = null;
      expect(visible()).toBe(false);

      CITY_STATUS.value = EMPTY_CITY_STATUS;
      asked();
      expect(visible()).toBe(true);
      expect(step()).toBe(CityPhase.Resolving);
    });
  });

  describe('the tails beside a row', () => {
    it('counts files against the row producing them', () => {
      asked();
      say({
        lifecycle: CityLifecycle.Loading,
        phase: CityPhase.Scanning,
        fetching: true,
        counts: { filesScanned: 1204 },
      });
      expect(tail(CityPhase.Scanning)).toBe('1,204 files');
    });

    it('shows git’s own counters while cloning, which is what says it is alive', () => {
      asked();
      say({
        lifecycle: CityLifecycle.Loading,
        phase: CityPhase.Cloning,
        fetching: true,
        fraction: 0.4,
        counts: { objects: 1200, objectsTotal: 4000, mib: 12 },
      });
      expect(tail(CityPhase.Cloning)).toBe('40% · 1,200/4,000 · 12 MiB');
    });

    // The silent promisor blob fetch reports no percent at all.
    it('falls back to the working tree growing on disk', () => {
      asked();
      say({
        lifecycle: CityLifecycle.Loading,
        phase: CityPhase.Cloning,
        fetching: true,
        counts: { mbOnDisk: 45 },
      });
      expect(tail(CityPhase.Cloning)).toBe('45 MB');
    });

    it('puts the build’s own part on the Building row', () => {
      asked();
      say({
        lifecycle: CityLifecycle.Loading,
        phase: CityPhase.Building,
        stage: BuildStage.Layout,
        fraction: 0.33,
        fetching: true,
      });
      expect(tail(CityPhase.Building)).toBe('33% layout');
    });

    it('clears a row’s tail when the city hands over to the next', () => {
      asked();
      say({
        lifecycle: CityLifecycle.Loading,
        phase: CityPhase.Scanning,
        fetching: true,
        counts: { filesScanned: 1204 },
      });
      expect(tail(CityPhase.Scanning)).toBe('1,204 files');

      // A stale "1,204 files" beside "Building city" reads as a scanner that is
      // still running.
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      expect(tail(CityPhase.Scanning)).toBeNull();
    });
  });

  describe('what the app knows and the city does not', () => {
    it('keeps the repo name up for the whole overlay, not just the stream', () => {
      asked();
      PENDING_SOURCE_LABEL.value = 'codecity';
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      expect(PENDING_SOURCE_LABEL.value).toBe('codecity');
    });

    it('leaves the freshness detail alone through a build', () => {
      REBUILD_DETAIL.value = '12,000 commits';
      asked();
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      expect(REBUILD_DETAIL.value).toBe('12,000 commits');
    });
  });
});
