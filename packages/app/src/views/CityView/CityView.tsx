// views/CityView — what `/city` renders: the city, flyable and pickable in the
// center pane, and the chrome that belongs to it. Everything city-shaped mounts
// here rather than at the root: the URL⇄view binding, the selection announcer,
// and the syntax theme the file preview reads.

import './CityView.css';
import { useEffect, useState } from 'preact/hooks';
import { CityProvider } from '@codecity/city/preact';
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
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { cancelLoad, refreshCurrentSource } from '@/hooks/useManifestSource';
import { useUrlViewState } from '@/router/useUrlViewState';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { LOADING_CANCEL } from '@/state/stores/progress';
import { CURRENT_SOURCE, clearSourceUrl } from '@/state/stores/source';
import {
  clearSelection,
  runCollisionCheck,
  runStemDiagnostic,
  runTreeGroundingCheck,
} from '@/state/stores/city';

export function CityView() {
  const [city, setCity] = useState<City | null>(null);
  // The panel it opens lives in this view's footer, so the key belongs here.
  useShortcutsKey();
  // Mode, scrub commit and selection are THIS city's, and this view's: the
  // landing has nothing to describe, and reflecting there would write them
  // onto `/`. A prop in, a callback out, and no binding to mount.
  const [viewState, onViewStateChange] = useUrlViewState();

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
      cancelLoad();
      clearSourceUrl();
    }
  };

  return (
    // Everything below reads THIS city. Held here rather than in a module slot,
    // which is what lets a second one exist with chrome of its own.
    <CityProvider city={city}>
      <a class="skip-link" href="#city-body">
        Skip to content
      </a>
      {/* The header owns the control; which read a refresh means in the mode
          you are in is the fetch layer's call. */}
      <CityHeader onSwitchSource={() => navigate(ROUTES.HOME)} onRefresh={refreshCurrentSource} />
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
      <CityFooter
        onRunCollisionCheck={runCollisionCheck}
        onRunStemDiagnostic={runStemDiagnostic}
        onRunTreeGroundingCheck={runTreeGroundingCheck}
      />
      {/* Belongs to this route: a load started from the landing shows its
          progress there, in the card it was started from. */}
      <LoadingOverlay onCancel={onCancelLoad} />
      <HljsThemeLink />
      <SelectionAnnouncer />
    </CityProvider>
  );
}
