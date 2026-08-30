// chrome/CityStage — the stage the city is performed on: the canvas, the
// selection chip, and the scene controls over it. The <City> is the package's,
// used with props; what makes it this app's city is what those props say.

import './CityStage.css';
import { useEffect, useMemo } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import { type City as CityInstance, type CityViewState, ScanError } from '@codecity/city';
import { City as CityCanvas } from '@codecity/city/preact';

import { TimelineScrubber } from '@/features/city/components/TimelineScrubber/TimelineScrubber';
import { TimelineToggle } from '@/features/city/components/TimelineToggle/TimelineToggle';
import { SelectionChip } from '@/features/city/components/CityStage/SelectionChip/SelectionChip';
import { createCityTooltip } from '@/features/city/components/CityTooltip/CityTooltip';
import { hoverTooltipContent } from '@/features/city/components/CityTooltip/tooltipContent';
import { useCityReport } from '@/features/city/hooks/useCityReport';
import { cityKeyboardEnabled } from '@/features/city/state/commands';
import { useCityChrome } from '@/features/city/state/sidebar';
import { CITY_SETTINGS } from '@/features/settings/state/values/city';
import { LIVE_UPDATES, LIVE_UPDATES_ACTIVE } from '@/features/settings/state/values/updates';
import { useCityUrl } from '@/router/cityUrl';
import { activeExcludePathsFor } from '@/state/excludes';
import { commitSource, SOURCE_ERROR } from '@/state/source';

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
  const chrome = useCityChrome();
  const { source } = useCityUrl();
  // Everything this app says ABOUT the city it is showing.
  useCityReport(source);
  const exclude = useComputed(() => (source ? activeExcludePathsFor(source.src) : undefined)).value;
  // Live updates are a reader setting, and zero seconds is off.
  const watchSeconds = useComputed(() =>
    LIVE_UPDATES_ACTIVE.value ? LIVE_UPDATES.value.POLL_SECONDS : undefined
  ).value;
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
        onPick={() => chrome.openDetails()}
        // The focus key makes the same request the panes' Focus buttons do, so
        // it gets the same chrome.
        onFocusRequest={() => chrome.revealCity()}
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
