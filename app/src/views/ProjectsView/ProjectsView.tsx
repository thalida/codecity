// The landing and the project switcher, one page. Renders null when closed so
// form/list state resets on the next open. It is also the loading surface for
// every switch it starts, so LoadingOverlay suppresses itself while visible —
// leaving the overlay to own deep-link cold boot alone.

import './ProjectsView.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { X, Waypoints, Building2, TreePine, Sparkles, History, Compass } from 'lucide-preact';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { GemIcon } from '@/components/GemIcon/GemIcon';
import { MetaLine } from '@/components/AppMeta/AppMeta';
import { LandingBackdrop } from '@/components/LandingBackdrop/LandingBackdrop';
import {
  PROJECTS_VIEW,
  LOADING_OVERLAY,
  clearProjectsViewError,
  FEATURED_CITY,
  type SourcePayload,
} from '@/state/stores/ui';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { RECENTS } from '@/state/stores/source';
import { stepForPhase } from '@/constants/loadingSteps';
import { LoadingProgress } from '@/components/LoadingProgress/LoadingProgress';
import { NewProjectForm } from '@/components/NewProjectForm/NewProjectForm';
import { RecentsList } from '@/components/RecentsList/RecentsList';
import { DiscoverList } from '@/components/DiscoverList/DiscoverList';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
import { DISCOVER } from '@/state/stores/discover';

const SOURCE_TAB = { recents: 'recents', discover: 'discover' } as const;
const SOURCE_PANEL_ID = 'landing-sources';

export interface ProjectsViewProps {
  onSubmit: (payload: SourcePayload) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function ProjectsView({ onSubmit, onCancel, onClose }: ProjectsViewProps) {
  const pv = PROJECTS_VIEW.value;
  const scan = SCAN_PROGRESS.value;
  const loading = scan !== null;
  const rootRef = useRef<HTMLDivElement>(null);

  // Recent is always offered, empty state and all, so a first visit learns that
  // codecity remembers what you open.
  const hasRecents = RECENTS.value.length > 0;
  const hasDiscover = DISCOVER.value.length > 0;
  const tabs = [
    { id: SOURCE_TAB.recents, label: 'Recent', icon: History },
    ...(hasDiscover ? [{ id: SOURCE_TAB.discover, label: 'Discover', icon: Compass }] : []),
  ];
  const [pickedTab, setPickedTab] = useState<string | null>(null);
  // Cleared on close, not on open: this returns null rather than unmounting, so
  // resetting on the way in would be a visible flip.
  useEffect(() => {
    if (!pv.visible) setPickedTab(null);
  }, [pv.visible]);
  // With nothing of your own yet, Discover is the tab with something in it.
  const defaultTab = !hasRecents && hasDiscover ? SOURCE_TAB.discover : SOURCE_TAB.recents;
  // During render, not via an effect: the server's list lands after first paint
  // and can take the Discover tab with it.
  const activeTab = tabs.some((t) => t.id === pickedTab) ? pickedTab : defaultTab;

  // Dismissible means it floats over a city, so it's a real dialog and traps
  // focus. The landing IS the page, with nothing behind to trap against.
  const isModal = pv.visible && pv.opts.dismissible;
  useDialogFocus(isModal, rootRef);

  // Escape closes the page when dismissible and not mid-load.
  useEffect(() => {
    if (!pv.visible || !pv.opts.dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pv.visible, pv.opts.dismissible, loading, onClose]);

  if (!pv.visible) return null;

  return (
    <div
      ref={rootRef}
      class={`landing${pv.opts.dismissible ? ' landing--modal' : ''}`}
      role={isModal ? 'dialog' : undefined}
      aria-modal={isModal ? 'true' : undefined}
      aria-label="codecity: open a project"
    >
      {/* The swirl is the fallback, so it yields to any real city behind it and
          stays put while one is still streaming. */}
      {!pv.opts.dismissible && !FEATURED_CITY.value && (
        <div class="landing-stage" aria-hidden="true">
          <LandingBackdrop />
        </div>
      )}

      {pv.opts.dismissible && !loading && (
        <button class="landing-close btn-icon btn-icon--lg" aria-label="Close" onClick={onClose}>
          <X class="icon" />
        </button>
      )}

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
          {FEATURED_CITY.value && (
            <p class="landing-featured">
              You're looking at <strong>{FEATURED_CITY.value.label}</strong>
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
                  onCancel={onCancel}
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
                  key={pv.opts.prefill?.src ?? ''}
                  allowLocalRepos={SERVER_CONFIG.value.allowLocalRepos}
                  hosted={SERVER_CONFIG.value.hosted}
                  error={pv.opts.error}
                  errorCode={pv.opts.errorCode}
                  prefill={pv.opts.prefill}
                  onSubmit={onSubmit}
                  onDirty={clearProjectsViewError}
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
                    <RecentsList onOpen={onSubmit} />
                  ) : (
                    <DiscoverList onOpen={onSubmit} />
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
