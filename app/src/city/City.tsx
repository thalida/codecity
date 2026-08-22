// city/City.tsx — a city on a <canvas>, and its Three.js lifecycle. Every city
// is a whole city; two of them differ only in the configuration passed here
// (see CityBindings), so there is one code path and no main one. Unmount tears
// the scene down, or a remount stacks a second renderer on the same canvas.

import './City.css';
import { useRef, useEffect } from 'preact/hooks';
import { effect, type ReadonlySignal, type Signal } from '@preact/signals';
import { createCityScene } from '@/city';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { SILENT_BUILD_REPORTER } from '@/state/stores/progress';
import type { CityScene as CityHandle, CityBindings } from '@/city/types';
import type { Manifest } from '@/types';

export interface CityProps extends CityBindings {
  /** What this city shows. Applied on every change, so whoever owns the signal
   *  owns the city's contents; null leaves the canvas empty. */
  source: ReadonlySignal<Manifest | null>;
  /** Published here while mounted, for whatever drives this instance. */
  handle?: Signal<CityHandle | null>;
  /** Paint the canvas: a sub-frame gap during a resize flashes through an
   *  unpainted one, which only matters where nothing sits behind it. */
  opaque?: boolean;
  /** What a screen reader is told this canvas is. */
  label?: string;
}

const DEFAULT_LABEL =
  '3D city map of the repository. Files are buildings, directories are streets, commits are trees. Browse it with the file tree and search panels.';

export function City({
  source,
  handle,
  opaque = false,
  label = DEFAULT_LABEL,
  report = SILENT_BUILD_REPORTER,
  ...bindings
}: CityProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let city: CityHandle | null = null;
    let unsubApply: (() => void) | null = null;
    let disposeReactions: (() => void) | null = null;

    // Starts empty; the apply below paints the first manifest.
    createCityScene(canvas, { report, ...bindings })
      .then((made) => {
        // Unmounted before the async build resolved: dispose the orphan now, or
        // its renderer + frame loop leak forever (nothing else holds a ref).
        if (disposed) {
          made.dispose();
          return;
        }
        city = made;
        if (handle) handle.value = made;
        // The city knows what it is showing and how to re-pack it, so a Save
        // needs to be told neither.
        disposeReactions = attachSettingsReactions({ city: made, report });

        // Only kicks the apply off and surfaces its error: reaching Idle is the
        // decoration pass's, and framing the composer's.
        unsubApply = effect(() => {
          const m = source.value;
          if (!m) return; // nothing to show yet
          // Scrubbing owns the contents while it runs. Peeked, so leaving the
          // mode doesn't repack what it committed (the teardown owns that).
          if (bindings.timeline?.store.mode.peek()) return;
          report.markRebuilding();
          void made.applyManifest(m).catch(report.markError);
        });
      })
      .catch(report.markError); // no WebGL, or a context the driver refused

    return () => {
      disposed = true;
      unsubApply?.();
      disposeReactions?.();
      city?.dispose();
      city = null;
      if (handle) handle.value = null;
      // The canvas is gone, so nothing it had on it is on screen: a remount
      // rebuilds from scratch, and that build is a load with a world to wait for.
      report.markGone();
    };
  }, []);

  // Non-text content needs a text alternative (WCAG 1.1.1). Keyboard users
  // browse the same data through Explore and Search.
  return (
    <canvas
      class={`city-canvas${opaque ? ' city-canvas--opaque' : ''}`}
      ref={canvasRef}
      role="img"
      aria-label={label}
    />
  );
}
