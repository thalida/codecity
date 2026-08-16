// views/HomeView — what `/` renders: the project switcher, over a city used as
// wallpaper. A route, not a modal, so being rendered IS being open: no
// visibility flag, no focus trap, no close button. You leave by opening a
// project, or by going Back.

import './HomeView.css';
import { useState } from 'preact/hooks';
import { Waypoints, Building2, TreePine, Sparkles, History, Compass } from 'lucide-preact';
import { City, CityVariant } from '@/city/City';
import { GemIcon } from '@/components/GemIcon/GemIcon';
import { MetaLine } from '@/components/AppMeta/AppMeta';
import { LOADING_OVERLAY } from '@/state/stores/loadingOverlay';
import { type SourcePayload } from '@/types/ui';
import { BACKDROP_CITY, RECENTS, SOURCE_ERROR } from '@/state/stores/source';
import { useHomeBackdrop } from '@/hooks/useHomeBackdrop';
import { loadSource, cancelLoad } from '@/hooks/useManifestSource';
import { SERVER_CONFIG, DISCOVER } from '@/state/stores/serverData';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { stepForPhase } from '@/constants/loadingSteps';
import { LoadingProgress } from '@/components/LoadingProgress/LoadingProgress';
import { NewProjectForm } from '@/components/NewProjectForm/NewProjectForm';
import { RecentsList } from '@/components/RecentsList/RecentsList';
import { DiscoverList } from '@/components/DiscoverList/DiscoverList';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';

const SOURCE_TAB = { recents: 'recents', discover: 'discover' } as const;
const SOURCE_PANEL_ID = 'landing-sources';

export function HomeView() {
  useHomeBackdrop();
  // The one way this view opens a project, whichever list or form asked.
  const open = (payload: SourcePayload): void => void loadSource(payload);
  const failed = SOURCE_ERROR.value;
  const scan = SCAN_PROGRESS.value;
  const loading = scan !== null;

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
  const activeTab = tabs.some((t) => t.id === pickedTab) ? pickedTab : defaultTab;

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

        <div class="landing-actions">
          {loading && scan ? (
            <section class="landing-card surface-glass">
              <div class="landing-progress">
                <LoadingProgress
                  activeStep={stepForPhase(scan.phase, scan.kind)}
                  kind={scan.kind}
                  branch={scan.branch}
                  // The tails (clone %, files scanned) are computed into
                  // LOADING_OVERLAY even while this surface owns the load.
                  stepTails={LOADING_OVERLAY.value.stepTails}
                  onCancel={cancelLoad}
                />
              </div>
            </section>
          ) : (
            <>
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
                  {activeTab === SOURCE_TAB.recents ? (
                    <RecentsList onOpen={open} />
                  ) : (
                    <DiscoverList onOpen={open} />
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
