// city/city.ts — a city you can hold.
//
// One class, and it IS the type. There used to be two lists — an object literal
// at the end of the composer and an interface beside it — kept in step by hand,
// which meant every method was written twice and drifted the first time someone
// added one to only one of them.
//
// Construction is async: a city compiles shaders, uploads an icon atlas and
// waits for a WebGL context, none of which a constructor can await. So the door
// is `City.create()`, the way a Mapbox Map or a tldraw Editor is handed to you
// ready rather than half-built.

import type * as THREE from 'three';

import { assembleCity } from './createCity';
import type { CityParts } from './cityParts';
import { refreshOnce, startWatch, type WatchOptions } from './data/watch';
import type { SourceLoader, SourceRequest } from './data/loadSource';
import type { TimelineRequest } from './data/loadTimeline';
import type { CityChangeListener } from './state/change';
import type { CityStatus } from './state/status';
import type { CityViewState } from './state/viewState';
import type { Picker } from './interaction/picker';
import type { CameraRig, FocusMode } from './render/cameraRig';
import type { CitySettingsStore } from './settings/store';
import type { CitySettingsPatch } from './settings';
import type { CodecityClient } from './client/index';
import type { CityEmitter } from './state/events';
import type { BuildStage } from './types/build';
import type { Manifest } from './types/manifest';
import type { TimelineBundle } from './types/timeline';
import type { CityExtension, CityThree, CityTimeline, CityWorld, FocusRef } from './types';

/** Everything a city can be told at construction. */
export interface CityOptions {
  /** Where this city's api lives. A same-origin PATH, never an origin. */
  baseUrl?: string;
  /** Opening values for its settings. */
  settings?: CitySettingsPatch;
  /** The city's own shortcuts. `false` turns them off; a predicate is asked per
   *  keystroke, which is how a host with a modal open keeps the keyboard. */
  keyboard?: boolean | (() => boolean);
  /** Layers of your own, drawn over the city's and ticked by the same loop. */
  extensions?: readonly CityExtension[];
}

export class City {
  /** Build one. Async because a city cannot exist until its WebGL context, its
   *  shaders and its icon atlas do, and a constructor cannot wait for those. */
  static async create(canvas: HTMLCanvasElement, options: CityOptions = {}): Promise<City> {
    return new City(await assembleCity(canvas, options));
  }

  /** Private: `create` is the only way to get one that actually works. */
  private constructor(private readonly parts: CityParts) {}

  // ── What it is made of ─────────────────────────────────────────────────

  get scene(): THREE.Scene {
    return this.parts.scene;
  }
  get picker(): Picker {
    return this.parts.picker;
  }
  get rig(): CameraRig {
    return this.parts.rig;
  }
  /** This city's own API client, on the base URL it was given. Exposed because
   *  a host's chrome talks to the same server about the same repo and should
   *  not build a second one. */
  get client(): CodecityClient {
    return this.parts.client;
  }
  /** This city's resolved settings. Read here; write through `updateSettings`. */
  get settings(): CitySettingsStore {
    return this.parts.settings;
  }
  /** The history this city is showing, and where in it. */
  get timeline(): CityTimeline {
    return this.parts.timeline;
  }
  /** Scene-internal reads and the diagnostics. */
  get world(): CityWorld {
    return this.parts.world;
  }
  /** The escape hatch, documented rather than discovered: a host doing
   *  something this API has no opinion about gets the raw renderer. Nothing in
   *  here promises to keep working if you write to it. */
  get three(): CityThree {
    return {
      scene: this.parts.scene,
      renderer: this.parts.renderer,
      camera: this.parts.rig.camera,
    };
  }

  // ── What it is doing ───────────────────────────────────────────────────

  /** One value: is there a city to look at, is more coming, which phase, how
   *  far. Readable at any moment — a host that mounts mid-load asks rather than
   *  needing to have been listening. */
  get status(): CityStatus {
    return this.parts.status.value;
  }

  /** The manifest this city is SHOWING — the union manifest in Timeline, since
   *  that is the city on screen. Null before the first apply. */
  get manifest(): Manifest | null {
    return this.parts.cityState.manifest;
  }

  /** Hear that `status` changed. */
  onStatus(listener: (status: CityStatus) => void): () => void {
    return this.parts.status.on(listener);
  }

  /** Told ONCE per turn, with what moved. What a UI binds to; the events below
   *  are the detail behind it. */
  onChange(listener: CityChangeListener): () => void {
    return this.parts.changes.on(listener);
  }

  /** Subscribe to what this city is doing, event by event. */
  get on(): CityEmitter['on'] {
    return this.parts.events.on;
  }

  // ── Showing a repo ─────────────────────────────────────────────────────

  /** Show a repo. The city fetches it, applies what comes back, and reports the
   *  scan as it goes. */
  loadSource(request: SourceRequest): ReturnType<SourceLoader['load']> {
    return this.parts.sourceLoader.load(request);
  }

  /** Stop whatever is loading. A load already superseded by another needs no
   *  cancelling: the next one does it. */
  cancelLoad(): void {
    this.parts.sourceLoader.cancel();
  }

  /** Show this repo's HISTORY: the union of every file that ever existed,
   *  packed once, with a scrubber over it. */
  loadTimeline(request: TimelineRequest): Promise<TimelineBundle> {
    return this.parts.timelineLoader.load(request);
  }

  /** Stop a timeline load. Only meaningful before the pack begins. */
  cancelTimelineLoad(): void {
    this.parts.timelineLoader.cancel();
  }

  /** Keep this city on the newest version of the repo it is showing: poll a
   *  cheap signature, re-apply only when it moves. A refresh, not a load — no
   *  skeleton, so buildings do not drop to placeholder heights and back on
   *  every save. Returns stop(). */
  watchSource(options?: WatchOptions): () => void {
    return startWatch(this.parts.watchDeps, options);
  }

  /** Ask once, now, whether the repo has moved. What a host calls when
   *  something IT knows about changed. */
  refreshSource(options?: WatchOptions): Promise<void> {
    return refreshOnce(this.parts.watchDeps, options);
  }

  /** Draw this manifest. Most hosts want `loadSource`; this is for one that
   *  already has a manifest in hand. */
  applyManifest(manifest: Manifest, leadingStages?: readonly BuildStage[]): Promise<void> {
    return this.parts.applyManifest(manifest, leadingStages);
  }

  /** The stages an apply would run, for a host whose own work comes first. */
  buildStagesFor(manifest: Manifest): BuildStage[] {
    return this.parts.buildStagesFor(manifest);
  }

  /** Drop the packed layout, so the next apply of the same manifest re-packs. */
  invalidateLayoutCache(): void {
    this.parts.invalidateLayoutCache();
  }

  // ── Where the reader is ────────────────────────────────────────────────

  /** Select what `ref` names and point the camera at it. False when there is
   *  nothing to look at, so a host's chrome can stay where it is. */
  focus(ref: FocusRef, mode?: FocusMode): boolean {
    return this.parts.focus(ref, mode);
  }

  /** The whole settings input surface: a plain patch, no reactive primitive of
   *  the host's. What it costs — a repack, a uniform refresh, nothing — is this
   *  city's decision, off each field's declared route. */
  updateSettings(patch: CitySettingsPatch): void {
    this.parts.settings.update(patch);
  }

  /** Where you are in this city, as one plain value: what is selected, and
   *  where the scrubber sits. Write it down, hand it back later. */
  getViewState(): CityViewState {
    const { picker, timeline } = this.parts;
    return {
      selection: picker.selectionKey,
      timeline: timeline.mode ? { mode: true, pos: timeline.pos } : null,
    };
  }

  /** Put this city back where a snapshot says. An absent field is left alone,
   *  so a host restoring only a selection says only that.
   *
   *  The selection goes in by KEY, not by target: the meshes it named are gone
   *  by now, and the picker re-resolves a key against whatever city is on
   *  screen — the same path a rebuild takes. */
  setViewState(next: CityViewState): void {
    const { picker, timeline } = this.parts;
    if (next.timeline !== undefined) {
      if (next.timeline) {
        if (!timeline.mode) timeline.enter();
        timeline.setPosition(next.timeline.pos);
      } else if (timeline.mode) {
        timeline.exit();
      }
    }
    if (next.selection !== undefined) picker.setSelectionKey(next.selection);
  }

  /** Tear all of it down. Required on unmount, or a remount stacks a second
   *  renderer and frame loop on the same canvas. */
  dispose(): void {
    this.parts.teardown();
  }
}
