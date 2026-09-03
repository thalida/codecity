// The overlay above the scene city. Everything it draws comes from ONE value —
// the city's own status — plus the one thing the app knows first: that it asked
// for a source at all. There is no second account of what is happening here to
// keep in step, which is what this file used to be full of.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BuildStage,
  CityLifecycle,
  CityPhase,
  EMPTY_CITY_STATUS,
  type CityStatus,
  SourceKind,
  TimelineStage,
} from '@codecity/city';
import {
  createOverlayDriver,
  LOADING_OVERLAY,
  PENDING_SOURCE_LABEL,
  LOADING_CANCEL,
  type LoadingSource,
} from '@/features/city/state/overlay';
import { REBUILD_DETAIL } from '@/features/city/state/readout';

import { LoadingStep, TIMELINE_LOADING_STEPS } from '@/features/city/state/loading';

// The driver is a plain reduction now: it is handed the status the city reports
// and what THIS app asked for, rather than reading either from a signal.
let drive: ReturnType<typeof createOverlayDriver>;
let status: CityStatus;
let askedFor: LoadingSource | null;

/** Put the city in a state, the way its own status would report it. */
function say(next: Partial<CityStatus>): void {
  status = { ...EMPTY_CITY_STATUS, ...next };
  drive(status, askedFor);
}

/** A load this app asked for, before the city has reported anything. */
const asked = (kind = SourceKind.Remote, branch?: string) => {
  askedFor = { kind, branch };
  drive(status, askedFor);
};

const visible = () => LOADING_OVERLAY.value.visible;
const step = () => LOADING_OVERLAY.value.activeStep;
const tail = (row: LoadingStep) => LOADING_OVERLAY.value.stepTails[row];

describe('the loading overlay', () => {
  beforeEach(() => {
    status = EMPTY_CITY_STATUS;
    askedFor = null;
    PENDING_SOURCE_LABEL.value = null;
    // A driver per test: it remembers how far down the rows this load got.
    drive = createOverlayDriver();
  });

  afterEach(() => {
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
      askedFor = null;
      drive(status, askedFor); // the stream has ended
      expect(visible()).toBe(true);
    });

    it('stays up through the last build after the stream has ended', () => {
      asked();
      say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
      askedFor = null;
      drive(status, askedFor);
      expect(visible()).toBe(true);
    });
  });

  describe('when it comes down', () => {
    it('goes once the city on screen says nothing is left to come', () => {
      asked();
      say({ lifecycle: CityLifecycle.Ready, fetching: true });
      expect(visible()).toBe(true);

      say({ lifecycle: CityLifecycle.Ready, fetching: false });
      askedFor = null;
      drive(status, askedFor);
      expect(visible()).toBe(false);
    });

    it('goes when the build errored, since no frame is coming', () => {
      asked();
      say({ lifecycle: CityLifecycle.Error, error: new Error('no such repo') });
      askedFor = null;
      drive(status, askedFor);
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
      askedFor = null;
      drive(status, askedFor);
      expect(visible()).toBe(false);

      say({});
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

// One overlay, two vocabularies. As two drivers the live rows opened over the
// timeline ones: "Resolving source", unnamed, over a repo already on screen.
describe('the same overlay, describing a timeline read', () => {
  const reading = { kind: SourceKind.Remote, branch: 'main', label: 'o/r' };

  beforeEach(() => {
    status = EMPTY_CITY_STATUS;
    askedFor = null;
    PENDING_SOURCE_LABEL.value = null;
    drive = createOverlayDriver();
  });

  afterEach(() => {
    LOADING_OVERLAY.value = { visible: false, showOpts: null, activeStep: null, stepTails: {} };
  });
  /** The city reporting a history read at `stage`, which is how it SAYS it. */
  const progress = (stage: TimelineStage) => {
    askedFor = reading;
    status = {
      ...EMPTY_CITY_STATUS,
      lifecycle: CityLifecycle.Loading,
      fetching: true,
      phase: CityPhase.Reading,
      timelineStage: stage,
    };
    drive(status, askedFor);
  };

  it('opens on the history rows, and names the repo already on screen', () => {
    progress(TimelineStage.History);

    expect(visible()).toBe(true);
    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);
    expect(step()).toBe(LoadingStep.TimelineHistory);

    expect(PENDING_SOURCE_LABEL.value).toBe('o/r');
  });

  // A read reports `fetching` exactly as a scan does, so inferring the kind
  // rather than asking is what opened the live rows over these.
  it('stays on the history rows for as long as the city says it is reading', () => {
    progress(TimelineStage.Fetch);
    progress(TimelineStage.History);
    progress(TimelineStage.Blobs);

    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);
    expect(step()).toBe(LoadingStep.TimelineBlobs);
  });

  it('moves to Building when the read hands over to the pack', () => {
    progress(TimelineStage.History);

    say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });
    expect(step()).toBe(LoadingStep.Building);
  });

  // The pack is part of the read, and the rows must not change under the
  // reader when it starts: they would watch a history read turn into a scan.
  it('keeps the history rows through the pack the read runs', () => {
    progress(TimelineStage.Blobs);

    say({ lifecycle: CityLifecycle.Loading, phase: CityPhase.Building, fetching: true });

    expect(LOADING_OVERLAY.value.showOpts?.steps).toEqual(TIMELINE_LOADING_STEPS);
  });

  it('comes down once the union city is up', () => {
    progress(TimelineStage.History);

    // Nothing in flight, so this app asks for nothing: exactly what
    // useCityReport passes once the city stops fetching.
    askedFor = null;
    say({ lifecycle: CityLifecycle.Ready, fetching: false });

    expect(visible()).toBe(false);
  });

  // The server counts commits and blobs as it goes, and a reader watching four
  // still rows has no way to tell a slow read from a stuck one.
  it('says how far the read has got, beside the row doing it', () => {
    askedFor = reading;
    say({
      lifecycle: CityLifecycle.Loading,
      fetching: true,
      phase: CityPhase.Reading,
      timelineStage: TimelineStage.History,
      counts: { commits: 276 },
    });

    expect(tail(LoadingStep.TimelineHistory)).toBe('276 commits');

    say({
      lifecycle: CityLifecycle.Loading,
      fetching: true,
      phase: CityPhase.Reading,
      timelineStage: TimelineStage.Blobs,
      counts: { blobsDone: 6179, blobsTotal: 6179 },
    });

    expect(tail(LoadingStep.TimelineBlobs)).toBe('6,179/6,179 files');
    // The row that handed over stops saying anything: a count left beside a
    // finished row reads as still running.
    expect(tail(LoadingStep.TimelineHistory)).toBeNull();
  });

  it('cancels to where the reader was, not to where a live cancel goes', () => {
    const went: string[] = [];
    drive = createOverlayDriver({
      live: () => went.push('live'),
      timeline: () => went.push('timeline'),
    });

    progress(TimelineStage.History);
    LOADING_CANCEL.value?.();

    expect(went).toEqual(['timeline']);
  });

  // Running the handler is half of it. The overlay comes down when the CITY
  // says the read ended, and a cancel that reports nothing leaves it up over a
  // read that already stopped.
  it('comes down once the city says the read was called off', () => {
    drive = createOverlayDriver({ timeline: () => {} });
    progress(TimelineStage.History);
    LOADING_CANCEL.value?.();

    // What the city's status reads as after timeline:cancel: the union city it
    // was reading over is still on screen, and nothing is coming.
    askedFor = null;
    say({ lifecycle: CityLifecycle.Ready, fetching: false });

    expect(visible()).toBe(false);
  });
});
