// views/CityView — what `/city` renders: the city, flyable and pickable in the
// center pane, and the chrome that belongs to it. Two components, because one
// cannot both provide a city and read one: the outer holds it, the inner is
// inside the provider and reads it through hooks like any other chrome.

import './CityView.css';
import { useEffect, useState } from 'preact/hooks';
import { CityProvider } from '@codecity/city/preact';
import { CityChromeProvider } from '@/views/CityView/state/sidebar';
import { LOADING_CANCEL } from '@/views/CityView/state/overlay';
import type { City } from '@codecity/city';
import { useSignalEffect } from '@preact/signals';

import { CityHeader } from './chrome/CityHeader/CityHeader';
import { CityFooter } from './chrome/CityFooter/CityFooter';
import { CityStage } from './chrome/CityStage/CityStage';
import { CitySidebarLeft } from './chrome/CitySidebarLeft/CitySidebarLeft';
import { CitySidebarRight } from './chrome/CitySidebarRight/CitySidebarRight';
import { LoadingOverlay } from '@/components/loading/LoadingOverlay/LoadingOverlay';
import { HljsThemeLink } from '@/views/CityView/HljsThemeLink/HljsThemeLink';
import { SelectionAnnouncer } from '@/views/CityView/SelectionAnnouncer/SelectionAnnouncer';
import { useShortcutsKey } from '@/views/CityView/hooks/useShortcutsKey';
import { useDocumentTitle } from '@/views/CityView/hooks/useDocumentTitle';
import { useCityCommands } from '@/views/CityView/hooks/useCityCommands';
import { refreshCurrentSource } from '@/views/CityView/hooks/useManifestSource';
import { useCityUrl, clearSourceUrl } from '@/router/cityUrl';
import { navigate, ROUTES } from '@/router/location';
import { CURRENT_SOURCE } from '@/state/source';
import {
  runCollisionCheck,
  runStemDiagnostic,
  runTreeGroundingCheck,
} from '@/views/CityView/state/commands';

export function CityView() {
  // Held here rather than in a module slot, which is what lets a second city
  // exist with chrome of its own.
  const [city, setCity] = useState<City | null>(null);
  // THIS city's view, and this view's: reflecting on the landing would write a
  // selection onto `/`. A prop in, a callback out, no binding to mount.
  const { viewState, onViewStateChange } = useCityUrl();

  return (
    <CityProvider city={city}>
      <CityChromeProvider>
        <CityChrome city={city} />
        <main id="city-body" tabIndex={-1}>
          <CitySidebarLeft />
          <CityStage
            city={city}
            onReady={setCity}
            viewState={viewState}
            onViewStateChange={onViewStateChange}
          />
          <CitySidebarRight />
        </main>
        <HljsThemeLink />
        <SelectionAnnouncer />
      </CityChromeProvider>
    </CityProvider>
  );
}

/** Everything around the stage. Inside the provider, so it asks the city the
 *  same way every other pane does. */
function CityChrome({ city }: { city: City | null }) {
  const { clearSelection } = useCityCommands();
  // The panel it opens lives in this view's footer, so the key belongs here.
  useShortcutsKey();
  // The tab is named after the city, not the app.
  useDocumentTitle();

  // Debug-only README screenshots. Imported only when asked for, so the harness
  // never ships in a normal session, and handed THIS city rather than finding one.
  useEffect(() => {
    if (!city || !new URLSearchParams(window.location.search).has('shot')) return;
    void import('@/capture/captureHarness').then((m) => m.captureCity(city));
  }, [city]);

  // A newly loaded source has nothing selected in it yet.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) clearSelection();
  });

  const onCancelLoad = () => {
    // A load with something to go back to registers its own handler; one with
    // nothing to go back to leaves the URL describing what it just called off.
    const registered = LOADING_CANCEL.peek();
    if (registered) registered();
    else {
      city?.cancelLoad();
      clearSourceUrl();
    }
  };

  return (
    <>
      <a class="skip-link" href="#city-body">
        Skip to content
      </a>
      {/* The header owns the control; which read a refresh means in the mode
          you are in is the fetch layer's call. */}
      <CityHeader
        onSwitchSource={() => navigate(ROUTES.HOME)}
        onRefresh={(skipCache) => refreshCurrentSource(city, skipCache)}
      />
      <CityFooter
        onRunCollisionCheck={() => runCollisionCheck(city)}
        onRunStemDiagnostic={() => runStemDiagnostic(city)}
        onRunTreeGroundingCheck={() => runTreeGroundingCheck(city)}
      />
      {/* Belongs to this route: a load started from the landing shows its
          progress there, in the card it was started from. */}
      <LoadingOverlay onCancel={onCancelLoad} />
    </>
  );
}
