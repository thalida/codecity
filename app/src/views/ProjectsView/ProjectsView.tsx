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
import { useEffect, useRef } from 'preact/hooks';
import { X, Waypoints, Building2, TreePine, Sparkles } from 'lucide-preact';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { GemIcon } from '@/components/GemIcon/GemIcon';
import { LandingBackdrop } from '@/components/LandingBackdrop/LandingBackdrop';
import { PROJECTS_VIEW, clearProjectsViewError, type SourcePayload } from '@/state/stores/ui';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { listRecents } from '@/state/stores/source';
import { stepForPhase } from '@/constants/loadingSteps';
import { LoadingProgress } from '@/components/LoadingProgress/LoadingProgress';
import { NewProjectForm } from '@/components/NewProjectForm/NewProjectForm';
import { RecentsList } from '@/components/RecentsList/RecentsList';

export interface ProjectsViewProps {
  onSubmit: (payload: SourcePayload) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function ProjectsView({ onSubmit, onCancel, onClose }: ProjectsViewProps) {
  const pv = PROJECTS_VIEW.value;
  const scan = SCAN_PROGRESS.value;
  const loading = scan !== null;
  const hasRecents = listRecents().length > 0;
  const rootRef = useRef<HTMLDivElement>(null);

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
      {/* Cold-boot only: the swirl backdrop. The dismissible modal shows the
          live city behind it instead (useSwitcherShowcase). */}
      {!pv.opts.dismissible && <LandingBackdrop />}

      {pv.opts.dismissible && !loading && (
        <button class="landing-close btn-icon btn-icon--lg" aria-label="Close" onClick={onClose}>
          <X class="icon" />
        </button>
      )}

      <div class="landing-inner">
        <section class="landing-hero">
          <div class="landing-brand">
            <span class="landing-gem">
              <GemIcon />
            </span>
            <h1 class="landing-wordmark">codecity</h1>
          </div>
          <p class="landing-tagline">Turn any git repo into a 3D city</p>
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
            <section class="landing-card surface-sidebar">
              <div class="landing-progress">
                <LoadingProgress
                  activeStep={stepForPhase(scan.phase, scan.kind)}
                  kind={scan.kind}
                  branch={scan.branch}
                  onCancel={onCancel}
                />
              </div>
            </section>
          ) : (
            <>
              <section class="landing-card surface-sidebar">
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
                  prefill={pv.opts.prefill}
                  onSubmit={onSubmit}
                  onDirty={clearProjectsViewError}
                />
              </section>
              {hasRecents && (
                <section class="landing-card surface-sidebar">
                  <h2 class="landing-card-title">Recent projects</h2>
                  <RecentsList onOpen={onSubmit} />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
