// views/ProjectsView/ProjectsView.tsx — the codecity landing + project switcher.
// A full-bleed page (not a modal): a brand hero next to an action panel that
// opens a new project or returns to a recent one. Reads PROJECTS_VIEW +
// SERVER_CONFIG for open-state/prefill; App owns onSubmit/onCancel/onClose.
// Renders null when closed so the form/list state resets on next open.
//
// This page is also the loading surface for every switch it initiates (design
// invariant): while SCAN_PROGRESS is non-null the action panel shows inline
// progress + Cancel, and <LoadingOverlay> (App-level) suppresses itself while
// this page is visible so the two never stack. LoadingOverlay keeps its narrow
// role of deep-link cold boot (no page open yet).

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
import { listRecents } from '@/state/stores/source';
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

  // Recents and Discover share one card so the action column can't grow a new
  // panel per feature. Recent is always offered, empty state and all, so a first
  // visit learns that codecity remembers what you open; Discover only appears
  // when the server actually sent a list.
  const hasRecents = listRecents().length > 0;
  const hasDiscover = DISCOVER.value.length > 0;
  const tabs = [
    { id: SOURCE_TAB.recents, label: 'Recent', icon: History },
    ...(hasDiscover ? [{ id: SOURCE_TAB.discover, label: 'Discover', icon: Compass }] : []),
  ];
  const [pickedTab, setPickedTab] = useState<string | null>(null);
  // With nothing of your own yet, Discover is the tab with something in it.
  const defaultTab = !hasRecents && hasDiscover ? SOURCE_TAB.discover : SOURCE_TAB.recents;
  // Falls back rather than being corrected by an effect: the server's list can
  // arrive after first paint and take the Discover tab with it, and a stored id
  // would point at a tab that no longer exists until the effect caught up.
  const activeTab = tabs.some((t) => t.id === pickedTab) ? pickedTab : defaultTab;

  // Dismissible = shown over an existing city, i.e. a real modal dialog: trap
  // and restore focus. The non-dismissible landing IS the page (nothing behind
  // to trap against), so it stays a plain region.
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
      {/* Cold boot has no city of its own to reveal, so the server's featured
          repo is rendered behind the page (useFeaturedCity) and the swirl sits
          over it. Over a loaded city the switcher reveals the real thing
          instead (useSwitcherShowcase). */}
      {!pv.opts.dismissible && (
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
            <div class="landing-brand">
              <span class="landing-gem">
                <GemIcon />
              </span>
              <h1 class="landing-wordmark">codecity</h1>
            </div>
            {/* The landing covers the app chrome, so without this nobody sees
                the version, the repo link or the credit until a repo loads. */}
            <MetaLine linkClass="link" />
          </div>
          <p class="landing-tagline">Turn any git repo into a 3D city</p>
          {/* Only ever set once the city is actually painted, so this cannot
              name something you can't see. */}
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
                  // Per-step tails (clone %, files scanned) are computed into
                  // LOADING_OVERLAY by loadingReactions even while this inline
                  // surface owns the load; forward them so the numbers show here
                  // too (the App-level overlay is suppressed).
                  stepTails={LOADING_OVERLAY.value.stepTails}
                  onCancel={onCancel}
                />
              </div>
            </section>
          ) : (
            <>
              <section class="landing-card surface-glass">
                <h2 class="landing-card-title">Open a project</h2>
                {/* A stale error from a prior attempt is dropped once a new load
                    starts (see the loading branch above) or as soon as the user
                    edits the source (onDirty); here it sits above the fresh form. */}
                {pv.opts.error && <div class="card-error">{pv.opts.error}</div>}
                <NewProjectForm
                  // Re-key on the prefill source so a failed submit (which
                  // reopens the view with the attempted src as prefill) remounts
                  // the form with that value restored — the field keeps what the
                  // user entered instead of clearing.
                  key={pv.opts.prefill?.src ?? ''}
                  allowLocalRepos={SERVER_CONFIG.value.allowLocalRepos}
                  hosted={SERVER_CONFIG.value.hosted}
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
