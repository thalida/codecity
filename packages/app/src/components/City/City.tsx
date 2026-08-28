// city/City.tsx — the <canvas> and its Three.js lifecycle: this folder's mount
// point, beside the createCity API it drives. Mount applies MANIFEST on every
// change, unmount tears the scene down so a remount cannot stack a second
// renderer on it, and the variant is all a view says about what it is FOR.

import type { Manifest } from '@codecity/city';
import './City.css';
import { useRef, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { createCity } from '@codecity/city';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { attachScanProgress } from '@/hooks/useManifestSource';
import { attachCityChrome, cityKeyboardEnabled } from '@/state/stores/city';
import { BACKDROP_SETTINGS, CITY_SETTINGS } from '@/state/settings/values/city';
import { BACKDROP_HANDLE, SCENE_HANDLE } from '@/state/stores/city';
import { MANIFEST } from '@/state/stores/manifest';
import { attachBuildProgress, attachCityStatus, CITY_STATUS } from '@/state/stores/progress';
import { CityLifecycle } from '@codecity/city';
import { createCityTooltip } from '@/components/CityTooltip/CityTooltip';
import { hoverTooltipContent } from '@/components/CityTooltip/tooltipContent';

export enum CityVariant {
  /** The app's main view: opaque, so a sub-frame gap during resize blends into
   *  the page instead of flashing through. */
  Scene = 'scene',
  /** Wallpaper: transparent, so whatever the view puts behind it (the hero
   *  image) shows until the city has something to paint. */
  Backdrop = 'backdrop',
}

export interface CityProps {
  variant?: CityVariant;
}

export function City({ variant = CityVariant.Scene }: CityProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let city: Awaited<ReturnType<typeof createCity>> | null = null;
    let unsubSettings: (() => void) | null = null;
    let disposeReactions: (() => void) | null = null;
    const unsubEvents: Array<() => void> = [];
    let tooltip: ReturnType<typeof createCityTooltip> | null = null;

    // Which of the app's two cameras this city gets. A backdrop orbits the gem
    // and turns; a scene fits the whole project. Both are the same fields.
    const settings = variant === CityVariant.Backdrop ? BACKDROP_SETTINGS : CITY_SETTINGS;

    // Start empty; the apply-effect below paints the first manifest.
    createCity(canvas, {
      settings: settings.peek(),
      keyboard: cityKeyboardEnabled,
    })
      .then((handle) => {
        // Unmounted before the async build resolved: dispose the orphan now, or
        // its renderer + frame loop leak forever (nothing else holds a ref).
        if (disposed) {
          handle.dispose();
          return;
        }
        city = handle;
        // The app holds the values and persists them; the instance holds its
        // own resolved copy. Pushed, never shared: two cities on one page can
        // hold different settings, and neither reads a global.
        unsubSettings = effect(() => handle.updateSettings(settings.value));
        // Published to its own slot: the two variants are independent cities.
        if (variant === CityVariant.Scene) SCENE_HANDLE.value = handle;
        else BACKDROP_HANDLE.value = handle;
        // A backdrop shows what its view decided to show, which is not the
        // opened project: useHomeBackdrop drives that canvas itself. Nor does
        // it get any chrome — this is where "each instance has its own" stops
        // being a claim about the package and becomes a fact about the page.
        if (variant !== CityVariant.Scene) return;

        // The overlay is a reduction over what THIS city reports. A backdrop
        // building behind the landing never reaches it, because a backdrop
        // never subscribes.
        // What this city is doing, as one value the chrome renders off. The
        // scene's only: a wallpaper building behind the landing must not move
        // the readout above the project being read.
        unsubEvents.push(attachCityStatus(handle));
        unsubEvents.push(attachBuildProgress(handle));

        // The flash for a Save the city answers by refreshing rather than
        // re-packing. Scene only: it writes the readout above this city.
        disposeReactions = attachSettingsReactions();

        // What the reader does in the canvas, and what this app's chrome does
        // about it. A backdrop never gets this: it has no chrome.
        unsubEvents.push(attachCityChrome(handle.on));

        // The card the cursor drags around. The city says what is under the
        // pointer; drawing something about it is the view's decision.
        tooltip = createCityTooltip(canvas);
        unsubEvents.push(
          handle.on('hover', ({ target }) => {
            const rootName = (MANIFEST.peek() as Manifest | null)?.tree?.name ?? null;
            tooltip?.show(hoverTooltipContent(target, rootName));
          })
        );

        // No manifest→scene effect: the city fetches its own repo, so what
        // used to arrive by watching a global now arrives by the same call that
        // asked for it. Two cities on one page each build what they were asked
        // to build, which one shared MANIFEST could never express.
        unsubEvents.push(attachScanProgress(handle.on));
      })
      .catch((err) => {
        // No WebGL, or a context the driver refused. There is no city to report
        // it — createCity never returned one — so this is the one failure the
        // app states itself. The landing has its wallpaper to fall back on.
        if (variant === CityVariant.Scene) {
          console.error('[codecity] could not create a city', err);
          CITY_STATUS.value = {
            ...CITY_STATUS.peek(),
            lifecycle: CityLifecycle.Error,
            fetching: false,
            error: err,
          };
        }
      });

    return () => {
      disposed = true;
      unsubSettings?.();
      disposeReactions?.();
      for (const off of unsubEvents) off();
      tooltip?.dispose();
      // Tear the city down so a remount doesn't stack a second renderer +
      // frame loop on the same canvas (old city keeps rendering as a ghost).
      city?.dispose();
      city = null;
      // Only its own slot: clearing the other would strand the city still up.
      if (variant === CityVariant.Scene) SCENE_HANDLE.value = null;
      else BACKDROP_HANDLE.value = null;
    };
  }, []);

  // Non-text content needs a text alternative (WCAG 1.1.1). Keyboard users
  // browse the same data through Explore and Search.
  return (
    <canvas
      id="city"
      class={`city-canvas city-canvas--${variant}`}
      ref={canvasRef}
      role="img"
      aria-label="3D city map of the repository. Files are buildings, directories are streets, commits are trees. Browse it with the file tree and search panels."
    />
  );
}
