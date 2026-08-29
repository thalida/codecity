// chrome/CityStage — the stage the city is performed on: the canvas, the
// selection chip, and the scene controls that sit over it.
//
// The <City> here is the package's, used with props. What makes it this app's
// city is what those props say: which settings values it gets, what its
// reports open, and that this is the one the chrome around it is about.

import './CityStage.css';
import { useEffect, useMemo } from 'preact/hooks';
import type { City as CityInstance, CityViewState, Manifest } from '@codecity/city';
import { City, CityLifecycle } from '@codecity/city';
import { City as CityCanvas } from '@codecity/city/preact';

import { TimelineScrubber } from '@/components/timeline/TimelineScrubber/TimelineScrubber';
import { TimelineToggle } from '@/components/timeline/TimelineToggle/TimelineToggle';
import { SelectionChip } from '@/views/CityView/chrome/CityStage/SelectionChip/SelectionChip';
import { createCityTooltip } from '@/components/CityTooltip/CityTooltip';
import { hoverTooltipContent } from '@/components/CityTooltip/tooltipContent';
import { attachCity } from '@/state/stores/attachCity';
import { cityKeyboardEnabled, revealCityChrome, SCENE_HANDLE } from '@/state/stores/city';
import { openSelectionPane } from '@/state/stores/chrome';
import { CITY_SETTINGS } from '@/state/settings/values/city';
import { MANIFEST } from '@/state/stores/manifest';
import { CITY_STATUS } from '@/state/stores/progress';

export function CityStage({
  city,
  onReady,
  viewState,
  onViewStateChange,
}: {
  city: CityInstance | null;
  onReady: (city: CityInstance | null) => void;
  viewState?: CityViewState;
  onViewStateChange?: (next: CityViewState) => void;
}) {
  // Everything this app keeps about the city it is showing, in one call.
  useEffect(() => (city ? attachCity(city) : undefined), [city]);

  // The last slot standing: the data hooks and the capture harness still reach
  // for it. Cleared by the effect that set it, so a remount cannot null a live
  // one out from under its replacement.
  useEffect(() => {
    SCENE_HANDLE.value = city;
    return () => void (SCENE_HANDLE.value = null);
  }, [city]);

  // The card the cursor drags around. The city says what is under the pointer;
  // drawing something about it is this view's decision.
  const tooltip = useMemo(() => createCityTooltip(), []);
  useEffect(() => () => tooltip.dispose(), [tooltip]);

  return (
    <div id="city-stage">
      <CityCanvas
        settings={CITY_SETTINGS.value}
        keyboard={cityKeyboardEnabled}
        onReady={onReady}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        onHover={(target) =>
          tooltip.show(
            hoverTooltipContent(target, (MANIFEST.peek() as Manifest | null)?.tree?.name ?? null)
          )
        }
        // Picking a node is asking what it is, so a pane put away for the last
        // one comes back for this one.
        onPick={() => openSelectionPane()}
        // The focus key makes the same request the panes' Focus buttons do, so
        // it gets the same chrome.
        onFocusRequest={() => revealCityChrome()}
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
      <SelectionChip />
      <div id="scene-controls">
        <TimelineScrubber />
        <TimelineToggle />
      </div>
    </div>
  );
}
