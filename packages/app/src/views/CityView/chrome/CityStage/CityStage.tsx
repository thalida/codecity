// chrome/CityStage — the stage the city is performed on: the canvas, the
// selection chip, and the scene controls over it. The <City> is the package's,
// used with props; what makes it this app's city is what those props say.

import './CityStage.css';
import { useEffect, useMemo } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import type { City as CityInstance, CityViewState } from '@codecity/city';
import { CityLifecycle } from '@codecity/city';
import { City as CityCanvas } from '@codecity/city/preact';

import { TimelineScrubber } from '@/components/timeline/TimelineScrubber/TimelineScrubber';
import { TimelineToggle } from '@/components/timeline/TimelineToggle/TimelineToggle';
import { SelectionChip } from '@/views/CityView/chrome/CityStage/SelectionChip/SelectionChip';
import { createCityTooltip } from '@/components/CityTooltip/CityTooltip';
import { hoverTooltipContent } from '@/components/CityTooltip/tooltipContent';
import { attachCity } from '@/state/stores/attachCity';
import { cityKeyboardEnabled, revealCityChrome } from '@/state/stores/city';
import { openSelectionPane } from '@/state/stores/chrome';
import { CITY_SETTINGS } from '@/state/settings/values/city';
import { LIVE_UPDATES, LIVE_UPDATES_ACTIVE } from '@/state/settings/values/updates';
import { useUrlSource } from '@/router/useUrlSource';
import { activeExcludePathsFor, commitSource, SOURCE_ERROR } from '@/state/stores/source';
import { ScanError } from '@codecity/city';
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
  // Straight off the URL, as values: a ?sel= write leaves src and branch alone,
  // so the city is never re-asked for the project it is already showing.
  const source = useUrlSource();
  const exclude = useComputed(() => (source ? activeExcludePathsFor(source.src) : undefined)).value;
  // Live updates are a reader setting, and zero seconds is off.
  const watchSeconds = useComputed(() =>
    LIVE_UPDATES_ACTIVE.value ? LIVE_UPDATES.value.POLL_SECONDS : undefined
  ).value;
  // Everything this app keeps about the city it is showing, in one call.
  useEffect(() => (city ? attachCity(city) : undefined), [city]);

  // The card the cursor drags around. The city says what is under the pointer;
  // drawing something about it is this view's decision.
  const tooltip = useMemo(() => createCityTooltip(), []);
  useEffect(() => () => tooltip.dispose(), [tooltip]);

  return (
    <div id="city-stage">
      <CityCanvas
        src={source?.src}
        branch={source?.branch}
        noCache={source?.noCache}
        exclude={exclude}
        watchSeconds={watchSeconds}
        settings={CITY_SETTINGS.value}
        keyboard={cityKeyboardEnabled}
        onReady={onReady}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        onHover={(target) =>
          tooltip.show(hoverTooltipContent(target, city?.manifest?.tree?.name ?? null))
        }
        // Picking a node is asking what it is, so a pane put away for the last
        // one comes back for this one.
        onPick={() => openSelectionPane()}
        // The focus key makes the same request the panes' Focus buttons do, so
        // it gets the same chrome.
        onFocusRequest={() => revealCityChrome()}
        // What the city just published is what this app calls the open
        // project: one commit point, whichever view asked for it.
        onChange={(change) => {
          if (!change.manifestChanged || !city || !source) return;
          const manifest = city.manifest;
          if (manifest) commitSource(source.src, source.branch, manifest);
        }}
        onError={(err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          if (source) {
            SOURCE_ERROR.value = {
              error: error.message,
              code: err instanceof ScanError ? err.code : undefined,
              prefill: { src: source.src, branch: source.branch },
            };
          }
          console.error('[codecity] could not load a city', error);
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
