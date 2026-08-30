// city.ts — a city, and how one is built.
//
// One class. `create` is async because a city cannot exist until its WebGL
// context, its shaders and its icon atlas do, and a constructor cannot wait for
// those; `assemble` below is the private half that wires forty pieces together
// and hands the constructor what it made.
//
// It used to be three files — a class, a composer, and an exported "parts" type
// in neither of their folders — which is a factory with extra steps rather than
// a class.

import * as THREE from 'three';
import { WatchDeps, WatchOptions, refreshOnce, startWatch } from './data/watch';
import { SourceLoader, SourceRequest, createSourceLoader } from './data/loadSource';
import { TimelineLoader, TimelineRequest, createTimelineLoader } from './data/loadTimeline';
import {
  CHANGE_FOR_EVENT,
  CityChange,
  CityChangeHub,
  CityChangeListener,
  createChangeHub,
} from './state/change';
import { CityStatus, CityStatusTracker, createCityStatus } from './state/status';
import type { CityViewState } from './state/viewState';
import { Picker, createPicker } from './interaction/picker';
import { CameraRig, FocusMode, createCameraRig } from './render/cameraRig';
import { NodeKind } from './types/manifest';
import { CitySettingsStore, createSettingsStore } from './settings/store';
import type { CitySettingsPatch } from './settings';
import type { CodecityClient } from './client/index';
import { CityEmitter, createEmitter } from './state/events';
import type { BuildStage } from './types/build';
import type { Manifest, RangeStat } from './types/manifest';
import type { TimelineBundle } from './types/timeline';
import type {
  CityExtension,
  CityThree,
  CityTimeline,
  CityWorld,
  FocusRef,
  SceneComponent,
  SceneContext,
} from './types';
import { registerShaderChunks } from './utils/shaders/registerShaderChunks';
import { createBuildings } from './components/buildings';
import { makeHeightContext } from './layout/dimensions';
import { createScrubController } from './timeline/scrubController';
import type { PathTimeline } from './timeline/replay';
import { createLayoutClient } from './layout';
import { createTreePlacementClient } from './components/trees/treePlacementClient';
import { CityState, createCityState } from './state';
import { createCityResources } from './render/resources';
import { ChangeRoute } from './settings/schema';
import { createClient } from './client';
import { nextPaint } from './utils/nextPaint';
import { createTimelineState } from './timeline/state';
import { layoutConfigFrom } from './layout/config';
import {
  runCollisionCheck,
  runStemPlacementDiagnostic,
  runTreeGroundingDiagnostic,
} from './utils/diagnostics';
import { createGem } from './components/gem';
import { createSky } from './components/sky';
import { ISLAND_TOP_Y, createIsland } from './components/island';
import { createRepoLabel } from './components/repoLabel';
import { repoLabelBounds } from './components/repoLabel/bounds';
import { createFootprint } from './components/footprint';
import { createStreets } from './components/streets';
import { createTrees } from './components/trees';
import { createFireflies } from './components/fireflies';
import { createPathLine } from './components/pathLine';
import { createInputHandlers } from './interaction/inputHandlers';
import { createPostFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';

/** What `create` built. Private: the shape of one class's own innards, which no
 *  consumer ever names. */
interface Assembled {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  picker: Picker;
  rig: CameraRig;
  client: CodecityClient;
  settings: CitySettingsStore;
  events: CityEmitter;
  status: CityStatusTracker;
  changes: CityChangeHub;
  cityState: CityState;
  timeline: CityTimeline;
  sourceLoader: SourceLoader;
  timelineLoader: TimelineLoader;
  watchDeps: WatchDeps;
  world: CityWorld;
  focus(ref: FocusRef, mode?: FocusMode): boolean;
  applyManifest(m: Manifest, leadingStages?: readonly BuildStage[]): Promise<void>;
  buildStagesFor(m: Manifest): BuildStage[];
  invalidateLayoutCache(): void;
  teardown(): void;
}

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
    return new City(await assemble(canvas, options));
  }

  /** Private: `create` is the only way to get one that actually works. */
  private constructor(private readonly parts: Assembled) {}

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
    if (!timeline.mode) return { selection: picker.selectionKey, timeline: null };
    // The sha it rests on, when it rests on one. At the present there is no
    // commit to name, and naming the last one would mean something different
    // the moment the branch moved.
    const atPresent = timeline.settledPos >= timeline.max;
    const commit = atPresent ? undefined : timeline.bundle?.commits[timeline.settledCommit]?.sha;
    return {
      selection: picker.selectionKey,
      timeline: { mode: true, pos: timeline.pos, ...(commit ? { commit } : {}) },
    };
  }

  /** Put this city back where a snapshot says — loading its history if the
   *  snapshot is in Timeline and this city is not. An absent field is left alone,
   *  so a host restoring only a selection says only that.
   *
   *  The selection goes in by KEY, not by target: the meshes it named are gone
   *  by now, and the picker re-resolves a key against whatever city is on
   *  screen — the same path a rebuild takes. */
  async setViewState(next: CityViewState): Promise<void> {
    const { picker, timeline, sourceLoader, cityState } = this.parts;

    if (next.timeline !== undefined) {
      if (next.timeline) {
        // Entering needs the repo's history, which is a fetch and a re-pack.
        // Doing it HERE is the point: a host restoring a link should hand the
        // city a view and be done, not orchestrate a load because this call
        // could only set a flag.
        if (!timeline.mode || !timeline.bundle) {
          const showing = sourceLoader.request();
          if (showing) {
            await this.loadTimeline({
              src: showing.src,
              branch: showing.branch,
              commit: next.timeline.commit,
            });
          } else if (!timeline.mode) {
            timeline.enter();
          }
        } else if (next.timeline.commit) {
          const index = timeline.bundle.commits.findIndex((c) => c.sha === next.timeline!.commit);
          if (index >= 0) timeline.setPosition(index);
        }
        if (next.timeline.pos !== undefined && !next.timeline.commit) {
          timeline.setPosition(next.timeline.pos);
        }
      } else if (timeline.mode) {
        timeline.exit();
        // The union city was packed from history; HEAD is a different city.
        // Leaving Timeline therefore means re-loading the source, which is this
        // city's business and not something a host should have to know.
        const showing = sourceLoader.request();
        if (showing) await this.loadSource(showing);
      }
    }

    if (next.selection !== undefined) {
      // A key names a node in a manifest. Before one is published there is
      // nothing to resolve it against, and resolving early would report the
      // selection as unreadable and drop it — so wait for the city to have a
      // city. A host handing over a deep link should not have to time it.
      if (next.selection && !cityState.manifest) await this.whenPublished();
      picker.setSelectionKey(next.selection);
      // Putting the reader back where a link says means showing them the node,
      // not just outlining it off screen. Recenter rather than Frame: it moves
      // the camera to the node without taking it off the angle it was on.
      if (next.selection) {
        this.focus(
          next.selection.kind === NodeKind.Commit
            ? { sha: next.selection.sha }
            : { path: next.selection.path },
          FocusMode.Recenter
        );
      }
    }
  }

  /** Resolves at the next published manifest. */
  private whenPublished(): Promise<void> {
    return new Promise((resolve) => {
      const stop = this.parts.cityState.on('published', () => {
        stop();
        resolve();
      });
    });
  }

  /** Tear all of it down. Required on unmount, or a remount stacks a second
   *  renderer and frame loop on the same canvas. */
  dispose(): void {
    this.parts.teardown();
  }
}

async function assemble(
  canvas: HTMLCanvasElement,
  {
    settings: initialSettings,
    baseUrl = '/api',
    extensions = [],
    keyboard = true,
  }: {
    settings?: CitySettingsPatch;
    baseUrl?: string;
    /** Layers of your own, built after the city's and drawn on top of them.
     *  Each gets the same context the city's own components get, is ticked by
     *  the same loop, and is disposed with the city. */
    extensions?: readonly CityExtension[];
    /** The city's own shortcuts (Esc, R, focus). `false` turns them off; a
     *  predicate is asked per keystroke, which is how a consumer with a modal
     *  open keeps the keyboard while it is. */
    keyboard?: boolean | (() => boolean);
  } = {}
): Promise<Assembled> {
  // Before anything that reads a setting: the material, the state pipeline and
  // every component resolve their values off this one instance's store.
  const settings = createSettingsStore(initialSettings);
  // This city's own subscribers. A second city on the page emits to its own,
  // so its build cannot move the overlay above the one being read.
  const events = createEmitter();
  // Same-origin only, and a path rather than an origin: a city fetches from the
  // server that served the page it is on.
  const client = createClient({ baseUrl });
  // The history this city is showing. Per instance, so two cities scrub their
  // own repos and neither drags the other's position.
  const timeline = createTimelineState();

  // Must precede any ShaderMaterial so #include <chunk> directives resolve.
  registerShaderChunks();

  const scene = new THREE.Scene();

  // Renderer FIRST, registered pre-apply (cached <img> onloads need it).
  // antialias OFF: with the composer, canvas MSAA does nothing yet costs 4x.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Cap at 2x (desktop-retina parity): phone 3–3.5x DPRs cube the fp16
  // composer buffers past what their GPUs sustain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  // Every GPU handle this city owns alone; registers the renderer for
  // facade-panel uploads (cached <img> onloads can race construction).
  const resources = createCityResources(renderer, settings);

  const layoutClient = createLayoutClient();
  // Both off-thread build workers, owned here and handed to the store that runs
  // the build. Lazy: neither spawns until its first compute().
  const treePlacementClient = createTreePlacementClient();
  const cityState = createCityState(layoutClient, treePlacementClient, resources, settings, events);
  // Pulled off cityState for the City handle; components never wire into
  // these — they rebuild reactively off cityState's signals.
  const { applyManifest: _applyManifest, buildStagesFor, invalidateLayoutCache } = cityState;

  // The last manifest applied at HEAD. Held because leaving Timeline has to
  // rebuild from it, and the union city on screen is not it.
  let liveManifest: Manifest | null = null;

  /** applyManifest, with a failure reported to this city's subscribers rather
   *  than left for every caller to catch and route somewhere. */
  async function applyManifest(...args: Parameters<typeof _applyManifest>): Promise<void> {
    try {
      await _applyManifest(...args);
      if (!timeline.mode) liveManifest = args[0];
    } catch (err) {
      events.emit('build:error', { error: err });
      throw err;
    }
  }

  // Fetches this city's own repo and applies what comes back. Declared after
  // applyManifest so the stream reaches the error reporting too.
  const sourceLoader = createSourceLoader({ client, events, applyManifest });

  // picker is backfilled below (built after the components it reads);
  // armOnFirstTick defers picker-dependent setup, so the null cast is safe.
  const ctx = {
    scene,
    canvas,
    cityState,
    resources,
    settings,
    timeline,
    client,
    picker: null,
  } as unknown as SceneContext;

  // Construction order is load-bearing: gem before repoLabel, streets
  // before buildings + pathLine (deps read at call time).
  const gem = createGem(ctx);
  const sky = createSky(ctx);
  const island = createIsland(ctx);
  const repoLabel = createRepoLabel(ctx, { getGem: () => gem.getRootGroup() });
  const footprint = createFootprint(ctx);
  const streets = createStreets(ctx);
  const buildings = createBuildings(ctx);
  const trees = createTrees(ctx);
  const fireflies = createFireflies(ctx);
  const pathLine = createPathLine(ctx);
  // TICK order (draw order is RENDER_ORDERS' job): sky LAST; gem after
  // repoLabel — the beam foot reads last frame's bob ON PURPOSE.
  const components: SceneComponent[] = [
    fireflies,
    repoLabel,
    buildings,
    trees,
    pathLine,
    streets,
    gem,
    island,
    footprint,
    sky,
  ];

  // A host's layers go on the END: they draw over the city's own, and they tick
  // after sky, which has to be the last of OURS (its camera-follow runs
  // immediately before the render). One that returns null adds nothing, which
  // is how an extension turns itself off without the host branching.
  const hostLayers = extensions.map((make) => make(ctx)).filter((c): c is SceneComponent => !!c);
  components.push(...hostLayers);

  for (const c of components) scene.add(c.group);

  // No boot apply: a scene with no manifest is a real state, so the components
  // start empty and the first applyManifest is the first city there has been.

  // The rig reads its framing inputs from cityState directly; deps carries
  // only component-geometry accessors state can't reach.
  const rig = createCameraRig({
    canvas,
    cityState,
    settings,
    deps: {
      // From the manifest + settings, never the label's meshes: those land on
      // the first tick, and framing that waits frames a different city (#62).
      getRepoLabelBounds: () =>
        repoLabelBounds(
          cityState.manifest?.tree?.name,
          cityState.gemWorldPos,
          settings.REPO_LABEL,
          settings.BUILDING_DIMENSIONS
        ),
      getTreeBoundsBySha: (sha) => trees.getRenderer()?.getTreeBoundsBySha(sha) ?? null,
    },
  });
  // Reframe only on a real source change — this city's own, not the page's.
  // cityRevision bumps after the apply's batch flushed, so the camera is aimed
  // at a built city, not half of one.
  let lastReframedSourceKey: string | null = null;
  const stopReframe = cityState.on('published', () => {
    const key = sourceLoader.key();
    if (key === null || key === lastReframedSourceKey) return;
    // No city yet: claiming the key here would make the first real one, which
    // is what there is to frame, skip its reframe.
    if (cityState.manifest === null) return;
    lastReframedSourceKey = key;
    rig.reset();
  });

  // The build is over when the city is ON SCREEN, not when applyStructure
  // returns: it starts the rebuilds without holding them (see render/LOADING.md).
  const stopOnScreen = cityState.on('published', () => {
    const drawn = cityState.manifest;
    if (drawn === null) return;
    void buildings.whenSettled().then(() => {
      // Two frames: render() only issues the GL commands, and the pixels land
      // a compositor pass later.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // A newer manifest is already on screen: this build's "done" would
          // report a city nobody is looking at, and its pending list would be
          // the older one's.
          if (cityState.manifest !== drawn) return;
          // What the manifest THIS build drew was still waiting on. The caller
          // needs it to tell "a city is up" from "the city is finished".
          events.emit('build:done', { pending: drawn.pending });
        })
      );
    });
  });

  const postFx = createPostFx(renderer, scene, rig.camera, settings);
  postFx.setSize(canvas.clientWidth, canvas.clientHeight);

  const picker = createPicker({
    canvas,
    camera: rig.camera,
    cityState,
    events,
    timeline,
    world: {
      getStreetPickables: () => streets.getPickables(),
      getRootGem: () => gem.getRootGroup(),
      getCells: () => buildings.getCells(),
      getTrees: () => trees.getRenderer(),
      getBuildingByPath: (p) => buildings.getBuildingByPath(p),
      getSidewalkByDir: (p) => streets.getSidewalkByDir(p),
      getStreetByDir: (p) => cityState.streetsByDirMap[p] ?? null,
      getBuildingIndex: () => buildings.getBuildingIndex(),
    },
  });

  // Backfill the picker BEFORE the frame loop so components arm on frame 1.
  ctx.picker = picker;

  const handlers = createInputHandlers({
    canvas,
    picker,
    rig,
    renderer,
    cityState,
    events,
    onResize() {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      // ResizeObserver fires on fractional layout jitter; a no-op "resize"
      // reallocates targets mid-frame, garbage on some mobile drivers.
      if (cw === _lastResizeW && ch === _lastResizeH) return;
      _lastResizeW = cw;
      _lastResizeH = ch;
      postFx.setSize(cw, ch);
      for (const c of components) c.onResize?.(cw, ch);
      // Synchronous paint so the canvas doesn't flash blank between resize and
      // the next frame; render path matches the loop so bloom shows immediately.
      postFx.render();
    },
    onResetView: rig.reset,
    keyboardEnabled: typeof keyboard === 'function' ? keyboard : () => keyboard,
    onFocusSelection() {
      // Reported, not acted on beyond the camera: a keystroke inside the canvas
      // is "look at it", and what the chrome around it should do about that
      // belongs to whoever drew the chrome.
      if (focus(null)) events.emit('focus', { target: picker.selection });
    },
  });

  // Scrub controller: built on entering Timeline mode (useTimelineMode); held here to dispose on uninstall.
  let _scrubController: ReturnType<typeof createScrubController> | null = null;

  // Reused scratch vector to avoid per-frame allocations from renderer.getSize().
  const renderSize = new THREE.Vector2();
  // Last size the resize handler acted on — its no-op jitter guard.
  let _lastResizeW = 0;
  let _lastResizeH = 0;
  // Last scrub position the removed-selection prune ran at — so it fires only when
  // the scrub actually MOVES, never on a static selection.
  let _lastPrunedScrubPos = -1;
  const stopFrameLoop = startFrameLoop(components, ctx, {
    rig,
    postFx,
    before() {
      // Idempotent per-frame size guard — resyncs renderer + composer to the
      // canvas whenever they diverge (ResizeObserver miss); cheap no-op else.
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      renderer.getSize(renderSize);
      if (cw > 0 && ch > 0 && (renderSize.x !== cw || renderSize.y !== ch)) {
        renderer.setSize(cw, ch, false);
        rig.camera.aspect = cw / Math.max(1, ch);
        rig.camera.updateProjectionMatrix();
        postFx.setSize(cw, ch);
        for (const c of components) c.onResize?.(cw, ch);
      }
    },
    after() {
      // Drop a selection the scrub removed, but not mid-drag: closing the right
      // sidebar then reflows the track under the pointer and jumps the position.
      if (!timeline.mode || timeline.dragging) return;
      const pos = timeline.pos;
      if (pos === _lastPrunedScrubPos) return;
      _lastPrunedScrubPos = pos;
      picker.pruneScrubHiddenSelection();
    },
  });

  // Object.assign onto the state, NOT `{...timeline}`: every value on a
  // TimelineState is a getter, so spreading copies what each one reads at this
  // moment and freezes it. Spread, `handle.timeline.mode` answers false for the
  // life of the city however many times the city enters Timeline.
  const timelineApi = Object.assign(timeline, {
    installScrubController(
      timelines: Map<string, PathTimeline>,
      commitLineRanges: RangeStat[]
    ): void {
      _scrubController?.dispose();
      _scrubController = createScrubController({
        buildings: {
          getBuildingIndex: () => buildings.getBuildingIndex(),
          applyScrub: (states) => buildings.applyScrub(states),
        },
        streets: { applyScrub: (states) => streets.applyScrub(states) },
        footprints: { applyScrub: (states) => footprint.applyScrub(states) },
        picker,
        timelines,
        commitLineRanges,
        heightCtx: makeHeightContext(cityState.manifest?.stats),
        scannedAt: cityState.manifest?.scanned_at,
        streetsByDir: cityState.streetsByDirMap,
        settings,
        timeline,
        scrubGates: [
          {
            setScrubCommit: (i) => trees.setScrubCommit(i),
            setScrubNow: (ms) => trees.setScrubNow(ms),
          },
          {
            setScrubCommit: (i) => fireflies.setScrubCommit(i),
            setScrubNow: (ms) => fireflies.setScrubNow(ms),
          },
        ],
      });
      buildings.setScrubController(_scrubController);
    },
    uninstallScrubController(): void {
      buildings.setScrubController(null);
      _scrubController?.dispose();
      _scrubController = null;
    },
    setStreetsTransparent: (on: boolean): void => streets.setStreetsTransparent(on),
    setFootprintsTransparent: (on: boolean): void => footprint.setFootprintsTransparent(on),
  });

  // Every Timeline exit. The union city holds buildings that do not exist at
  // HEAD, so only a rebuild from this city's own live manifest is a valid live
  // city — the app's would be a different repo on the landing.
  // A rebuild-routed setting moved, so this city re-packs ITSELF, from the
  // manifest IT is showing. The host used to do this: it watched its own signals
  // for a change of route, then handed a city a manifest to apply. That worked
  // for one city — the other one on the page got the first one's manifest,
  // because the host only has one — and it re-derived, from string signatures
  // over globals, a fact this store already computed exactly.
  // Folded from this city's own events, so a host reads one value instead of
  // reassembling eleven. Constructed here rather than lazily: it has to hear
  // the first scan:start, and a host that subscribes late still gets the truth.
  const status = createCityStatus(events.on);

  // Showing a repo's history is a way of showing a city, not a host feature.
  // The order inside it is the whole difficulty (mode before the manifest,
  // transparency after the pack, controller last), and it belongs where the
  // pieces it orders live.
  const timelineLoader = createTimelineLoader({
    client,
    events,
    timeline,
    applyManifest: (m, leading) => applyManifest(m, leading),
    setStreetsTransparent: (on) => streets.setStreetsTransparent(on),
    setFootprintsTransparent: (on) => footprint.setFootprintsTransparent(on),
    installScrubController: (replay, ranges) => timelineApi.installScrubController(replay, ranges),
    uninstallScrubController: () => timelineApi.uninstallScrubController(),
    nextPaint,
  });

  const watchDeps = {
    client,
    loader: sourceLoader,
    timeline,
    events,
    applyManifest: (m: Manifest) => applyManifest(m),
    currentSignature: () => cityState.manifest?.content_signature ?? null,
  };

  // One notification for a host that re-renders, batched to a microtask: an
  // apply publishes a manifest, moves the selection and ends a build inside one
  // turn, and a host that repainted three times for it did two nobody asked for.
  const changes = createChangeHub(() => ({
    status: status.value,
    manifest: cityState.manifest,
    selection: picker.selection,
    hover: picker.hover,
  }));
  const stopChangeRelay = Object.entries(CHANGE_FOR_EVENT).map(([name, part]) =>
    events.on(name as keyof typeof CHANGE_FOR_EVENT, () => changes.mark(part as keyof CityChange))
  );
  // A manifest is applied, however it got here: through the stream, or from a
  // host calling applyManifest itself. The publish is the change, not the
  // stream event that only one of those two paths produces.
  stopChangeRelay.push(cityState.on('published', () => changes.mark('manifestChanged')));
  // The timeline reports on its own object, not through the emitter.
  stopChangeRelay.push(
    ...(['mode', 'bundle', 'position'] as const).map((kind) =>
      timeline.on(kind, () => changes.mark('timelineChanged'))
    )
  );

  const stopSettingsRebuild = settings.onRoute(ChangeRoute.Rebuild, () => {
    // The manifest is unchanged, so the layout would be reused and the setting
    // would do nothing visible.
    invalidateLayoutCache();
    // Best-effort, like the teardown below: a dispose or a newer apply can
    // supersede this mid-flight, and neither is a failure worth reporting.
    void repack().catch(() => {});
  });

  /** Re-pack whatever this city is showing. In Timeline that is the union city
   *  its own bundle describes, which has to be re-dressed and re-gated after the
   *  pack: applyManifest rebuilds the street and footprint meshes opaque, and
   *  drops the scrub controller with the meshes it drove. */
  async function repack(): Promise<void> {
    if (timeline.mode) {
      const bundle = timeline.bundle;
      const replay = timeline.timelines;
      if (!bundle || !replay) return;
      await applyManifest(bundle.unionManifest as unknown as Manifest);
      timelineApi.setStreetsTransparent(true);
      timelineApi.setFootprintsTransparent(true);
      timelineApi.installScrubController(replay, bundle.commitLineRanges);
      return;
    }
    if (liveManifest) await applyManifest(liveManifest);
  }

  const stopTimelineTeardown = timeline.on('mode', () => {
    if (timeline.mode || !_scrubController) return;
    timelineApi.uninstallScrubController();
    const live = liveManifest;
    // Best-effort: a dispose or a newer apply can supersede this mid-flight,
    // and neither is a failure worth surfacing from a teardown.
    if (live) void applyManifest(live).catch(() => {});
  });

  /** Select what `ref` names and aim the camera at it: the one place a ref
   *  becomes a focus. Null means "whatever is already selected". False when
   *  there is nothing to look at, so a caller's chrome can stay put. */
  function focus(ref: FocusRef, mode?: FocusMode): boolean {
    const sel =
      ref === null
        ? picker.selection
        : 'sha' in ref
          ? picker.selectByCommit(ref.sha)
          : picker.selectByPath(ref.path);
    if (!sel) return false;
    rig.focusSelection(sel, mode);
    return true;
  }

  // What the class holds. The composer above is the messy half — forty locals
  // wired to each other — and this is the tidy handover: everything City needs,
  // named once, so the API surface next door reads as an API rather than as the
  // tail of a build script.
  return {
    scene,
    renderer,
    picker,
    rig,
    client,
    settings,
    events,
    status,
    changes,
    cityState,
    timeline: timelineApi,
    sourceLoader,
    timelineLoader,
    watchDeps,
    focus,
    applyManifest,
    buildStagesFor,
    invalidateLayoutCache,
    world: {
      getTrees: () => trees.getRenderer(),
      runCollisionCheck: () => runCollisionCheck(cityState),
      runStemPlacementDiagnostic: () =>
        runStemPlacementDiagnostic(cityState, layoutConfigFrom(settings)),
      runTreeGroundingDiagnostic: () =>
        runTreeGroundingDiagnostic(trees.getRenderer()?.group ?? null, ISLAND_TOP_Y),
    },
    /** Full teardown, loop FIRST, renderer LAST — else a remount stacks a ghost
     *  city whose picker still answers raycasts. */
    teardown(): void {
      // Listeners first: nothing below may call back into a view that is on its
      // way out, and a torn-down city has nothing left worth reporting.
      for (const off of stopChangeRelay) off();
      changes.dispose();
      status.dispose();
      events.clear();
      sourceLoader.dispose();
      timelineLoader.dispose();
      timeline.dispose();
      stopFrameLoop();
      stopReframe();
      stopOnScreen();
      stopSettingsRebuild();
      stopTimelineTeardown();
      _scrubController?.dispose();
      handlers.dispose();
      picker.dispose();
      rig.dispose();
      postFx.dispose();
      for (const c of components) c.dispose();
      layoutClient.dispose();
      treePlacementClient.dispose();
      // dispose() leaves the WebGL context alive; without forceContextLoss()
      // every teardown leaks one until Chrome's ~16-per-page cap blocks new.
      resources.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
