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

import { createCity } from '../createCity';
import type { City as CityInstance } from '../types';
import type { CityExtension } from '../types';
import type { CitySettingsPatch } from '../settings';
import type { CityStatus } from '../state/status';
import type { CityChange, CityChangeContext } from '../state/change';
import type { CityViewState } from '../state/viewState';
import type { SourceRequest } from '../data/loadSource';

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
  /** Where to put the reader: selection and scrub position. Applied when it
   *  changes, so a host can drive it from a URL. */
  viewState?: CityViewState;
  /** Keep up with the repo, polling every this many seconds. */
  watchSeconds?: number;

  /** The instance, once it exists — and null once it is gone. Everything not
   *  expressible as a prop goes through this. */
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

    void createCity(canvas, {
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

  const { src, branch, skeleton } = props;
  const exclude = props.exclude?.join('\n');
  useEffect(() => {
    if (!city || !src) return;
    const request: SourceRequest = {
      src,
      branch,
      skeleton,
      exclude: exclude ? exclude.split('\n') : undefined,
    };
    // A superseded load is not a failure: the next one aborted it on purpose.
    void city.loadSource(request).catch((error) => {
      if (city.status.error === error) handlers.current.onError?.(error);
    });
  }, [city, src, branch, skeleton, exclude]);

  const { viewState } = props;
  useEffect(() => {
    if (city && viewState) city.setViewState(viewState);
  }, [city, viewState]);

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
