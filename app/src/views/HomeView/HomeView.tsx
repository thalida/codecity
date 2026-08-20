// views/HomeView — what `/` renders: the project switcher, over a city used as
// wallpaper. A route, not a modal, so being rendered IS being open: no
// visibility flag, no focus trap, no close button. You leave by opening a
// project, or by going Back.

import './HomeView.css';
import { useState } from 'preact/hooks';
import { Waypoints, Building2, TreePine, Sparkles, History, Compass } from 'lucide-preact';
import { City, CityVariant } from '@/city/City';
import { GemIcon } from '@/components/app/GemIcon/GemIcon';
import { MetaLine } from '@/components/app/MetaLine/MetaLine';
import { type SourcePayload } from '@/types/ui';
import { BACKDROP_CITY, RECENTS, SOURCE_ERROR } from '@/state/stores/source';
import { useHomeBackdrop } from '@/hooks/useHomeBackdrop';
import { hrefFor, navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { URL_PARAMS } from '@/constants/urlParams';
import { SERVER_CONFIG, DISCOVER } from '@/state/stores/serverData';
import { NewProjectForm } from '@/components/sources/NewProjectForm/NewProjectForm';
import { RecentsList } from '@/components/sources/RecentsList/RecentsList';
import { DiscoverList } from '@/components/sources/DiscoverList/DiscoverList';
import { PaneTabs } from '@/components/panes/PaneTabs/PaneTabs';

const SOURCE_TAB = { recents: 'recents', discover: 'discover' } as const;
const SOURCE_PANEL_ID = 'landing-sources';

export function HomeView() {
  useHomeBackdrop();
  // Navigate, don't load: the URL carrying a src IS the load trigger, the same
  // one a deep link uses. Loading here waited for the scan before routing.
  const open = (payload: SourcePayload): void => {
    const params = new URLSearchParams();
    params.set(URL_PARAMS.SRC, payload.src);
    if (payload.branch) params.set(URL_PARAMS.BRANCH, payload.branch);
    navigate(hrefFor(ROUTES.CITY, params));
  };
  const failed = SOURCE_ERROR.value;

  // Recent is always offered, empty state and all, so a first visit learns that
  // codecity remembers what you open.
  const hasRecents = RECENTS.value.length > 0;
  const hasDiscover = DISCOVER.value.length > 0;
  const tabs = [
    { id: SOURCE_TAB.recents, label: 'Recent', icon: History },
    ...(hasDiscover ? [{ id: SOURCE_TAB.discover, label: 'Discover', icon: Compass }] : []),
  ];
  const [pickedTab, setPickedTab] = useState<string | null>(null);
  // With nothing of your own yet, Discover is the tab with something in it.
  const defaultTab = !hasRecents && hasDiscover ? SOURCE_TAB.discover : SOURCE_TAB.recents;
  // During render, not via an effect: the server's list lands after first paint
  // and can take the Discover tab with it.
  const activeTab =
    pickedTab !== null && tabs.some((t) => t.id === pickedTab) ? pickedTab : defaultTab;

  const painted = BACKDROP_CITY.value !== null;

  return (
    <main class="landing">
      {/* Wallpaper first, the city over it once one paints: here the canvas is
          decoration, so it carries no chrome and no controls. */}
      <div class={`landing-stage${painted ? ' is-painted' : ''}`} aria-hidden="true">
        <City variant={CityVariant.Backdrop} />
      </div>

      <div class="landing-inner">
        <section class="landing-hero">
          <div class="landing-identity">
            {/* Plain anchor: a full navigation home, clearing ?src. */}
            <a class="landing-brand" href="/" aria-label="codecity home">
              <span class="landing-gem">
                <GemIcon />
              </span>
              <h1 class="landing-wordmark">codecity</h1>
            </a>
            {/* The landing covers the chrome, so this is the only place the
                version and credit appear before a repo loads. */}
            <MetaLine linkClass="link" />
          </div>
          <p class="landing-tagline">Turn any git repo into a 3D city</p>
          {/* Set only once the city is painted, so it can't name something you
              can't see. */}
          {BACKDROP_CITY.value && (
            <p class="landing-featured">
              You're looking at <strong>{BACKDROP_CITY.value.label}</strong>
            </p>
          )}
          <ul class="landing-delights">
            <li class="landing-delight landing-delight--streets">
              <Waypoints class="icon" aria-hidden="true" />
              <span>
                Directories become <strong>streets</strong>
              </span>
            </li>
            <li class="landing-delight landing-delight--buildings">
              <Building2 class="icon" aria-hidden="true" />
              <span>
                Files rise into <strong>buildings</strong>
              </span>
            </li>
            <li class="landing-delight landing-delight--trees">
              <TreePine class="icon" aria-hidden="true" />
              <span>
                Every commit grows a <strong>tree</strong>
              </span>
            </li>
            <li class="landing-delight landing-delight--authors">
              <Sparkles class="icon" aria-hidden="true" />
              <span>
                Commit authors orbit trees as <strong>fireflies</strong>
              </span>
            </li>
          </ul>
        </section>

        {/* No progress surface here: committing a source routes to /city
            immediately, and the overlay there owns every load. */}
        <div class="landing-actions">
          <section class="landing-card surface-glass">
            <h2 class="landing-card-title">Open a project</h2>
            <NewProjectForm
              // Remount on a new prefill so a failed submit restores what
              // was typed instead of clearing it.
              key={failed?.prefill?.src ?? ''}
              allowLocalRepos={SERVER_CONFIG.value.allowLocalRepos}
              hosted={SERVER_CONFIG.value.hosted}
              error={failed?.error}
              errorCode={failed?.code}
              prefill={failed?.prefill}
              onSubmit={open}
            />
          </section>
          <section class="landing-card landing-card--sources surface-glass">
            <PaneTabs
              tabs={tabs}
              active={activeTab}
              onSelect={setPickedTab}
              panelId={SOURCE_PANEL_ID}
              class="landing-tabs"
            />
            <div
              id={SOURCE_PANEL_ID}
              role="tabpanel"
              aria-labelledby={`${SOURCE_PANEL_ID}-tab-${activeTab}`}
              class="landing-tabpanel"
            >
              {activeTab === SOURCE_TAB.recents ? <RecentsList /> : <DiscoverList />}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
