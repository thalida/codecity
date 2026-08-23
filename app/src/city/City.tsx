// city/City.tsx — a city on a <canvas>, and its Three.js lifecycle. It renders
// a session: what to show, who hears about the build and what scrubs it all
// come from there, so two of these are two sessions and nothing else. Unmount
// tears the scene down, or a remount stacks a second renderer on one canvas.

import './City.css';
import { useRef, useEffect } from 'preact/hooks';
import { computed, effect } from '@preact/signals';
import { createCityScene } from '@/city/scene';
import { rebuildOnSave } from '@/city/session/rebuildOnSave';
import type { CitySession } from '@/city/session/session';
import type { Manifest } from '@/types';

export interface CityProps {
  /** The city to render. Everything this canvas needs is in it. */
  session: CitySession;
  /** What a screen reader is told this canvas is. */
  label?: string;
}

const DEFAULT_LABEL =
  '3D city map of the repository. Files are buildings, directories are streets, commits are trees. Browse it with the file tree and search panels.';

export function City({ session, label = DEFAULT_LABEL }: CityProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let unsubApply: (() => void) | null = null;
    let disposeReactions: (() => void) | null = null;

    const { manifest, progress, timeline } = session;
    // The store's value spans the skeleton the stream emits before it is fully
    // typed; the scene takes manifests.
    const showing = computed<Manifest | null>(() => manifest.current.value as Manifest | null);

    // Starts empty; the apply below paints the first manifest.
    createCityScene(canvas, session)
      .then((built) => {
        // Unmounted before the async build resolved: dispose the orphan now, or
        // its renderer + frame loop leak forever (nothing else holds a ref).
        if (disposed) {
          built.dispose();
          return;
        }
        session.scene.value = built;
        // It knows what it is showing and how to re-pack it, so a Save needs to
        // be told neither.
        disposeReactions = rebuildOnSave({
          scene: built,
          report: progress,
          config: session.config,
        });

        // Only kicks the apply off and surfaces its error: reaching Idle is the
        // decoration pass's, and framing the composer's.
        unsubApply = effect(() => {
          const m = showing.value;
          if (!m) return; // nothing to show yet
          // Scrubbing owns the contents while it runs. Peeked, so leaving the
          // mode doesn't repack what it committed (the teardown owns that).
          if (timeline.mode.peek()) return;
          void built.applyManifest(m).catch(progress.markError);
        });
      })
      .catch(progress.markError); // no WebGL, or a context the driver refused

    return () => {
      disposed = true;
      unsubApply?.();
      disposeReactions?.();
      session.scene.peek()?.dispose();
      session.scene.value = null;
      // The canvas is gone, so nothing it had on it is on screen: a remount
      // rebuilds from scratch, and that build is a load with a world to wait for.
      progress.markGone();
    };
  }, []);

  // Non-text content needs a text alternative (WCAG 1.1.1). Keyboard users
  // browse the same data through Explore and Search.
  return <canvas class="city-canvas" ref={canvasRef} role="img" aria-label={label} />;
}
