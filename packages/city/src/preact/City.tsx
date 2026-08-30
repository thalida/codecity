// @codecity/city/preact — a city as a component.
//
// The package's core knows no framework, and this subpath is the adapter, the
// way zustand ships zustand/vanilla beside zustand/react. `preact` is an
// OPTIONAL peer: a host that never imports this subpath never installs it.
//
// A real component, not a mount script. Props go in and are LIVE — change
// `settings` and the city is told; change `src` and it loads. The instance
// comes back out through `onReady`, the way Excalidraw hands back
// excalidrawAPI, so a host that wants to drive it directly gets the real thing
// rather than a wrapper over it.

import './City.css';
import { useEffect, useRef, useState } from 'preact/hooks';

import { City as CityInstance } from '../city';
import type { CityExtension } from '../types';
import type { CitySettingsPatch } from '../settings';
import type { CityStatus } from '../state/status';
import type { CityChange, CityChangeContext } from '../state/change';
import { sameViewState, type CityViewState } from '../state/viewState';
import type { Manifest } from '../types/manifest';
import type { SourceRequest } from '../data/loadSource';
import type { PickTarget } from '../types/picker';

export interface CityProps {
  /** Where this city's api lives. A same-origin PATH, never an origin. */
  baseUrl?: string;
  /** The repo to show. Changing it loads the new one; omitting it leaves the
   *  city empty for a host that calls `loadSource` itself. */
  src?: string;
  branch?: string;
  /** Paths to leave out of the scan. */
  exclude?: string[];
  /** Show structure while the server resolves per-file metadata. False waits
   *  for the finished city, which is what a city behind other content wants. */
  skeleton?: boolean;

  /** Values for the city's settings. LIVE: change them and the city is told,
   *  and it works out what each change costs. */
  settings?: CitySettingsPatch;
  /** The city's own shortcuts. `false` turns them off; a predicate is asked per
   *  keystroke, which is how a host with a modal open keeps the keyboard. */
  keyboard?: boolean | (() => boolean);
  /** Layers of your own, drawn over the city's. */
  extensions?: readonly CityExtension[];
  /** Where to put the reader: selection, timeline mode, scrub position.
   *  Applied whenever it changes, so a host drives it from a URL, a stored
   *  session, or a list of bookmarks — the controlled half of the pair below. */
  viewState?: CityViewState;
  /** The city's view moved. The uncontrolled half: a host writes this back to
   *  wherever it keeps one, and hands the result back as `viewState`.
   *
   *  Together these are `value`/`onChange` for where the reader is, which is
   *  why a host needs no imperative binding of its own. */
  onViewStateChange?: (view: CityViewState) => void;
  /** Keep up with the repo, polling every this many seconds. */
  watchSeconds?: number;

  // ── What the reader did ────────────────────────────────────────────────
  // Intent, not state. A host wiring its own chrome to a city should not have
  // to reach for the instance to hear that someone clicked something.

  /** What is selected changed — however it got selected: a click, a restored
   *  link, a host calling focus(). Null is nothing selected. */
  /** Ask the server to re-scan rather than answer from its cache. */
  noCache?: boolean;
  /** Show this manifest, instead of loading one from a `src`. For a host that
   *  already has the manifest — it built it, cached it, or fetched it to decide
   *  whether to show it at all. Changing it shows the new one. */
  manifest?: Manifest | null;
  onSelect?: (target: PickTarget | null) => void;
  /** What the POINTER is over, the moment it resolves. The event a cursor-
   *  following tooltip wants; null is nothing under it. */
  onHover?: (target: PickTarget | null) => void;
  /** The reader picked something IN THE CANVAS. Fires on every completed pick,
   *  including re-picking what is already picked — which `onSelect` does not,
   *  because nothing changed. That re-pick is how a reader gets back to a pane
   *  they closed, so it has to be about the input, not the state. */
  onPick?: (target: PickTarget | null) => void;
  /** The reader asked the CITY to look at something — its focus key, not a
   *  host calling focus(), which already knows it asked. */
  onFocusRequest?: (target: PickTarget | null) => void;

  /** The instance, once it exists — and null once it is gone. The escape hatch:
   *  everything not expressible as a prop goes through this. A host should not
   *  need it for anything above. */
  onReady?: (city: CityInstance | null) => void;
  /** What it is doing, whenever that changes. */
  onStatus?: (status: CityStatus) => void;
  /** Told once per turn, with what moved. */
  onChange?: (change: CityChange, context: CityChangeContext) => void;
  /** No WebGL, or a context the driver refused — there is no city to report it,
   *  so a host has to be told directly. Also a load that failed. */
  onError?: (error: unknown) => void;

  /** Opaque by default; transparent lets what is behind it show through. */
  transparent?: boolean;
  class?: string;
  /** Overrides the default, which describes a city to a screen reader. */
  'aria-label'?: string;
}

const DEFAULT_LABEL =
  'A 3D city built from a code repository. Files are buildings, directories are streets, and commits are trees.';

/** A city, as a component. */
export function City(props: CityProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [city, setCity] = useState<CityInstance | null>(null);

  // Callbacks through a ref: a host that re-renders with a new closure must not
  // get a second city, so the mount effect below depends on nothing.
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let instance: CityInstance | null = null;

    void CityInstance.create(canvas, {
      baseUrl: handlers.current.baseUrl,
      settings: handlers.current.settings,
      keyboard: handlers.current.keyboard,
      extensions: handlers.current.extensions,
    })
      .then((made) => {
        // Unmounted before the async build resolved: dispose the orphan, or its
        // renderer and frame loop leak — nothing else holds a reference.
        if (disposed) {
          made.dispose();
          return;
        }
        instance = made;
        setCity(made);
        handlers.current.onReady?.(made);
      })
      .catch((error) => {
        if (!disposed) handlers.current.onError?.(error);
      });

    return () => {
      disposed = true;
      handlers.current.onReady?.(null);
      setCity(null);
      // Or a remount stacks a second renderer and frame loop on the same
      // canvas, and the old one keeps drawing as a ghost.
      instance?.dispose();
      instance = null;
    };
  }, []);

  // ── The bindings ───────────────────────────────────────────────────────
  // Each is a prop the host can change at any time, and each does nothing
  // until the city exists — which is why they are separate effects rather than
  // work crammed into the mount above.

  const { settings } = props;
  useEffect(() => {
    if (city && settings) city.updateSettings(settings);
  }, [city, settings]);

  // Which repo is on screen. Editing `exclude` changes the QUESTION, not the
  // repo: it re-scans in place, keeping the city you are looking at, where a
  // new src drops it and loads the next one behind the loading report.
  const { src, branch, skeleton, noCache } = props;
  const exclude = props.exclude?.join('\n');
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!city || !src) return;
    const fail = (error: Error) => {
      // A superseded load is not a failure: the next one aborted it on purpose.
      if (city.status.error === error) handlers.current.onError?.(error);
    };
    const excludes = () => handlers.current.exclude;

    const key = `${src}\u0000${branch ?? ''}\u0000${noCache ? '1' : ''}`;
    if (loaded.current === key) {
      void city.refreshSource({ excludes, onError: fail });
      return;
    }
    loaded.current = key;
    const request: SourceRequest = {
      src,
      branch,
      skeleton,
      noCache,
      exclude: exclude ? exclude.split('\n') : undefined,
    };
    void city.loadSource(request).catch(fail);
  }, [city, src, branch, skeleton, noCache, exclude]);

  const { manifest } = props;
  useEffect(() => {
    if (city && manifest) void city.applyManifest(manifest);
  }, [city, manifest]);

  // Controlled view state. A host that reflects `onViewStateChange` straight
  // back in is the normal case, not a mistake, so an echo of what the city
  // already reports is dropped rather than re-applied.
  const { viewState } = props;
  useEffect(() => {
    if (!city || !viewState) return;
    if (sameViewState(viewState, city.getViewState())) return;
    void city.setViewState(viewState);
  }, [city, viewState]);

  useEffect(() => {
    if (!city) return;
    return city.onChange((change) => {
      if (!change.selectionChanged && !change.timelineChanged) return;
      handlers.current.onViewStateChange?.(city.getViewState());
    });
  }, [city]);

  const { watchSeconds } = props;
  useEffect(() => {
    if (!city || watchSeconds === undefined) return;
    return city.watchSource({
      intervalSeconds: watchSeconds,
      excludes: () => handlers.current.exclude,
      onError: (error) => handlers.current.onError?.(error),
    });
  }, [city, watchSeconds]);

  useEffect(() => {
    if (!city) return;
    // Called immediately as well as on change: a host rendering off status
    // wants the current one, not only the next.
    handlers.current.onStatus?.(city.status);
    return city.onStatus((status) => handlers.current.onStatus?.(status));
  }, [city]);

  useEffect(() => {
    if (!city) return;
    return city.onChange((change, context) => handlers.current.onChange?.(change, context));
  }, [city]);

  // The reader's own doings, as props. A host wiring a details pane should
  // never have to hold the instance to hear about a click.
  useEffect(() => {
    if (!city) return;
    const stop = [
      city.on('select', ({ target }) => handlers.current.onSelect?.(target)),
      city.on('hover', ({ target }) => handlers.current.onHover?.(target)),
      city.on('pick', ({ target }) => handlers.current.onPick?.(target)),
      city.on('focus', ({ target }) => handlers.current.onFocusRequest?.(target)),
    ];
    return () => {
      for (const off of stop) off();
    };
  }, [city]);

  return (
    <canvas
      ref={canvasRef}
      class={`codecity-canvas codecity-canvas--${props.transparent ? 'transparent' : 'opaque'}${
        props.class ? ` ${props.class}` : ''
      }`}
      // Non-text content needs a text alternative (WCAG 1.1.1).
      role="img"
      aria-label={props['aria-label'] ?? DEFAULT_LABEL}
    />
  );
}
