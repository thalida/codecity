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
import { useEffect } from 'preact/hooks';
import { X, Waypoints, Building2, TreePine, Sparkles } from 'lucide-preact';
import { GemIcon } from '@/components/GemIcon/GemIcon';
import { PROJECTS_VIEW, type SourcePayload } from '@/state/stores/ui';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { PENDING_SOURCE_LABEL, listRecents } from '@/state/stores/source';
import { LOADING_STEP_LABELS, stepForPhase } from '@/constants/loadingSteps';
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
    <div class="landing" aria-label="codecity: open a project">
      {pv.opts.dismissible && !loading && (
        <button class="landing-close btn-icon btn-icon--lg" aria-label="Close" onClick={onClose}>
          <X class="lucide-icon" />
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
              <Waypoints class="lucide-icon" aria-hidden="true" />
              <span>
                Directories become <strong>streets</strong>
              </span>
            </li>
            <li class="landing-delight landing-delight--buildings">
              <Building2 class="lucide-icon" aria-hidden="true" />
              <span>
                Files rise into <strong>buildings</strong>
              </span>
            </li>
            <li class="landing-delight landing-delight--trees">
              <TreePine class="lucide-icon" aria-hidden="true" />
              <span>
                Every commit grows a <strong>tree</strong>
              </span>
            </li>
            <li class="landing-delight landing-delight--authors">
              <Sparkles class="lucide-icon" aria-hidden="true" />
              <span>
                Commit authors orbit trees as <strong>fireflies</strong>
              </span>
            </li>
          </ul>
        </section>

        <div class="landing-actions">
          {loading && scan ? (
            <section class="landing-card surface-sidebar">
              <div class="landing-progress" role="status" aria-live="polite">
                {PENDING_SOURCE_LABEL.value && (
                  <div class="loading-pending-label">{PENDING_SOURCE_LABEL.value}</div>
                )}
                <div class="loading-spinner" />
                <div class="text-card-title is-loading">
                  {LOADING_STEP_LABELS[stepForPhase(scan.phase, scan.kind)]}
                  {'…'}
                </div>
                <button type="button" class="btn-secondary" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </section>
          ) : (
            <>
              <section class="landing-card surface-sidebar">
                <h2 class="landing-card-title">Open a project</h2>
                {/* A stale error from a prior attempt is dropped once a new load
                    starts (see the loading branch above) — here it sits above the
                    fresh form. */}
                {pv.opts.error && <div class="card-error">{pv.opts.error}</div>}
                <NewProjectForm
                  allowLocalRepos={SERVER_CONFIG.value.allowLocalRepos}
                  prefill={pv.opts.prefill}
                  onSubmit={onSubmit}
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
