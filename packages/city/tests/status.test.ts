// The fold every host would otherwise write. Two axes, deliberately: whether
// there is a city to look at, and whether more is still coming. The states that
// matter are the combinations — Ready + fetching is a real city on screen with
// history still streaming, which is the one a host reveals too early.

import { describe, it, expect } from 'vitest';
import { createEmitter } from '../src/events';
import { createCityStatus, CityLifecycle, CityPhase } from '../src/status';
import { ScanPhase } from '../src/client/manifest';
import { BuildStage } from '../src/types/build';
import { EMPTY_MANIFEST } from './_helpers/manifestFixtures';
import type { Manifest } from '../src/types/manifest';

function tracked() {
  const events = createEmitter();
  const status = createCityStatus(events.on);
  return { events, status };
}

const manifest = (pending: Manifest['pending'] = []) =>
  ({ ...EMPTY_MANIFEST, pending }) as Manifest;

describe('a city’s status', () => {
  it('starts empty, with nothing claimed', () => {
    const { status } = tracked();
    expect(status.value.lifecycle).toBe(CityLifecycle.Empty);
    expect(status.value.fetching).toBe(false);
    expect(status.value.phase).toBeNull();
  });

  it('is readable without having listened', () => {
    const { events, status } = tracked();
    events.emit('scan:start', { src: '/repo' });

    // No subscription was ever made. The value is still the truth, which is the
    // whole point: a host that mounts mid-load asks rather than reassembles.
    expect(status.value.lifecycle).toBe(CityLifecycle.Loading);
    expect(status.value.phase).toBe(CityPhase.Resolving);
  });

  it('reports one phase vocabulary across the stream and the build', () => {
    const { events, status } = tracked();
    events.emit('scan:start', { src: '/repo' });
    expect(status.value.phase).toBe(CityPhase.Resolving);

    events.emit('scan:progress', {
      event: { phase: ScanPhase.CloneProgress, percent: 40 } as never,
    });
    expect(status.value.phase).toBe(CityPhase.Cloning);
    expect(status.value.fraction).toBeCloseTo(0.4);

    events.emit('scan:progress', {
      event: { phase: ScanPhase.ScanProgress, files_scanned: 1204 } as never,
    });
    expect(status.value.phase).toBe(CityPhase.Scanning);
    expect(status.value.counts.filesScanned).toBe(1204);

    events.emit('scan:manifest', {
      manifest: manifest(['metadata']),
      phase: ScanPhase.PartialManifest,
    });
    expect(status.value.phase).toBe(CityPhase.Sketching);

    events.emit('build:start', { stages: [BuildStage.Layout, BuildStage.Assemble] });
    expect(status.value.phase).toBe(CityPhase.Building);
  });

  // The crux. A partial manifest is a real city, and history is still coming.
  it('is ready AND fetching when the city on screen is not the final one', () => {
    const { events, status } = tracked();
    events.emit('scan:start', { src: '/repo' });
    events.emit('build:start', { stages: [BuildStage.Layout] });
    events.emit('build:done', { pending: ['history'] });

    expect(status.value.lifecycle).toBe(CityLifecycle.Ready);
    expect(status.value.fetching).toBe(true);
  });

  it('stops fetching once the city on screen says it is final', () => {
    const { events, status } = tracked();
    events.emit('scan:start', { src: '/repo' });
    events.emit('build:done', { pending: ['history'] });
    expect(status.value.fetching).toBe(true);

    events.emit('build:done', { pending: [] });
    expect(status.value.lifecycle).toBe(CityLifecycle.Ready);
    expect(status.value.fetching).toBe(false);
  });

  // Loading is "nothing to look at yet". A rebuild behind a city already up is
  // not that, or a host would blank a perfectly good city to show a spinner.
  it('stays Ready through a rebuild of a city already on screen', () => {
    const { events, status } = tracked();
    events.emit('build:done', { pending: [] });
    expect(status.value.lifecycle).toBe(CityLifecycle.Ready);

    events.emit('scan:start', { src: '/repo' });
    expect(status.value.lifecycle).toBe(CityLifecycle.Ready);
    expect(status.value.fetching).toBe(true);
  });

  it('carries a fraction over the whole build, not the stage it is in', () => {
    const { events, status } = tracked();
    const stages = [BuildStage.Icons, BuildStage.Layout, BuildStage.Assemble, BuildStage.Decorate];
    events.emit('build:start', { stages });

    events.emit('build:stage', { stage: BuildStage.Layout }); // second of four
    expect(status.value.fraction).toBeCloseTo(0.25);

    events.emit('build:progress', { percent: 50 }); // half through that stage
    expect(status.value.fraction).toBeCloseTo(0.375);

    events.emit('build:stage', { stage: BuildStage.Decorate }); // fourth of four
    expect(status.value.fraction).toBeCloseTo(0.75);
  });

  // The denominator is the plan THIS build runs: an apply that reuses the
  // packed layout and skips the atlas has fewer stages, and must open its own
  // build rather than sitting a third of the way through someone else's.
  it('counts against the plan the build actually runs', () => {
    const { events, status } = tracked();
    events.emit('build:start', { stages: [BuildStage.Layout, BuildStage.Assemble] });
    events.emit('build:stage', { stage: BuildStage.Layout });
    expect(status.value.fraction).toBeCloseTo(0);
    expect(status.value.stage).toBe(BuildStage.Layout);

    events.emit('build:stage', { stage: BuildStage.Assemble });
    expect(status.value.fraction).toBeCloseTo(0.5);
  });

  it('reports an error, and clears it when new work starts', () => {
    const { events, status } = tracked();
    const boom = new Error('no such repo');
    events.emit('scan:error', { error: boom });
    expect(status.value.lifecycle).toBe(CityLifecycle.Error);
    expect(status.value.error).toBe(boom);
    expect(status.value.fetching).toBe(false);

    events.emit('scan:start', { src: '/other' });
    expect(status.value.error).toBeNull();
  });

  it('tells subscribers when it changes, and stops when they leave', () => {
    const { events, status } = tracked();
    const seen: CityLifecycle[] = [];
    const off = status.on((s) => seen.push(s.lifecycle));

    events.emit('scan:start', { src: '/repo' });
    events.emit('build:done', { pending: [] });
    expect(seen).toEqual([CityLifecycle.Loading, CityLifecycle.Ready]);

    off();
    events.emit('scan:error', { error: new Error('x') });
    expect(seen).toHaveLength(2);
  });

  it('says nothing when an event changes none of the answers', () => {
    const { events, status } = tracked();
    events.emit('build:done', { pending: [] });
    let told = 0;
    status.on(() => told++);

    events.emit('build:done', { pending: [] });
    expect(told).toBe(0);
  });
});
