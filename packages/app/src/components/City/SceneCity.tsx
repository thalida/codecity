// components/City/SceneCity.tsx — this app's two cities.
//
// The <City> next door is portable and knows nothing about this app. These are
// where it meets this one: which settings values it gets, which slot it
// publishes to, and whether it gets any chrome at all.
//
// Two components rather than one with a flag, because they are two jobs. The
// scene is the project you are reading, and everything this app shows about a
// city is about that one. The backdrop is wallpaper: a whole city with no
// chrome, which useHomeBackdrop drives itself.

import { useCallback, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import type { City as CityInstance, Manifest } from '@codecity/city';
import { CityLifecycle } from '@codecity/city';

import { City } from '@codecity/city/preact';
import { attachCity } from '@/state/stores/attachCity';
import { cityKeyboardEnabled } from '@/state/stores/city';
import { BACKDROP_SETTINGS, CITY_SETTINGS } from '@/state/settings/values/city';
import { BACKDROP_HANDLE, SCENE_HANDLE } from '@/state/stores/city';
import { MANIFEST } from '@/state/stores/manifest';
import { CITY_STATUS } from '@/state/stores/progress';
import { createCityTooltip } from '@/components/CityTooltip/CityTooltip';
import { hoverTooltipContent } from '@/components/CityTooltip/tooltipContent';

/** Everything this app attaches to one city, and the one way to take it back.
 *  Held in a ref rather than at module scope: two of these can be mounted, and
 *  a remount must not release the previous one's subscriptions. */
function useCityBinding(bind: (city: CityInstance) => Array<() => void>) {
  const offs = useRef<Array<() => void>>([]);
  return useCallback(
    (city: CityInstance | null) => {
      for (const off of offs.current) off();
      offs.current = city ? bind(city) : [];
    },
    [bind]
  );
}

/** Push this app's settings values into a city for as long as it lives. The app
 *  holds and persists them; the instance holds its own resolved copy. Pushed,
 *  never shared: two cities on one page hold different values, and neither
 *  reads a global. */
const pushSettings = (city: CityInstance, values: typeof CITY_SETTINGS) =>
  effect(() => city.updateSettings(values.value));

/** The project you are reading. */
export function SceneCity() {
  const onReady = useCityBinding((city) => {
    SCENE_HANDLE.value = city;
    // The card the cursor drags around. The city says what is under the
    // pointer; drawing something about it is this view's decision — and the
    // canvas to draw it over is the city's own, not one found in the document.
    const tooltip = createCityTooltip(city.three.renderer.domElement);
    return [
      pushSettings(city, CITY_SETTINGS),
      // Everything this app keeps about the city it is showing, in one call.
      attachCity(city),
      city.on('hover', ({ target }) => {
        const rootName = (MANIFEST.peek() as Manifest | null)?.tree?.name ?? null;
        tooltip.show(hoverTooltipContent(target, rootName));
      }),
      () => tooltip.dispose(),
      () => void (SCENE_HANDLE.value = null),
    ];
  });

  return (
    <City
      settings={CITY_SETTINGS.value}
      keyboard={cityKeyboardEnabled}
      onReady={onReady}
      onError={(error) => {
        console.error('[codecity] could not create a city', error);
        CITY_STATUS.value = {
          ...CITY_STATUS.peek(),
          lifecycle: CityLifecycle.Error,
          fetching: false,
          error,
        };
      }}
    />
  );
}

/** The landing's wallpaper: a whole city, drawn behind the page, with no chrome
 *  pointed at it. useHomeBackdrop decides what it shows. */
export function BackdropCity() {
  const onReady = useCityBinding((city) => {
    BACKDROP_HANDLE.value = city;
    return [pushSettings(city, BACKDROP_SETTINGS), () => void (BACKDROP_HANDLE.value = null)];
  });

  return <City transparent settings={BACKDROP_SETTINGS.value} keyboard={false} onReady={onReady} />;
}
