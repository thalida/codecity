// views/ProjectsView/ProjectsView.tsx — full-viewport project switcher. Reads
// PROJECTS_VIEW + SERVER_CONFIG for open-state/prefill; App owns
// onSubmit/onCancel/onClose. Renders null when closed so the form/list state
// resets on next open. Replaces the old modal SourcePicker.
//
// This view is the loading surface for every switch it initiates (design
// invariant): while SCAN_PROGRESS is non-null it renders inline progress in
// place of the form + recents, and <LoadingOverlay> (App-level) suppresses
// itself whenever this view is visible, so the two never stack. LoadingOverlay
// keeps its narrow role of deep-link cold boot (no view open yet).

import './ProjectsView.css';
import { useEffect } from 'preact/hooks';
import { X } from 'lucide-preact';
import { PROJECTS_VIEW, type SourcePayload } from '@/state/stores/ui';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { PENDING_SOURCE_LABEL } from '@/state/stores/source';
import { LOADING_STEP_LABELS, stepForPhase } from '@/constants/loadingSteps';
import { NewProjectForm } from './NewProjectForm';
import { RecentsList } from './RecentsList';

export interface ProjectsViewProps {
  onSubmit: (payload: SourcePayload) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function ProjectsView({ onSubmit, onCancel, onClose }: ProjectsViewProps) {
  const pv = PROJECTS_VIEW.value;
  const scan = SCAN_PROGRESS.value;
  const loading = scan !== null;

  // Escape closes the view when dismissible and not mid-load.
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
    <div class="projects-view" role="dialog" aria-modal="true" aria-label="Open project">
      <div class="projects-view-panel card-overlay">
        <div class="projects-view-header surface-chrome">
          <span>Open project</span>
          {pv.opts.dismissible && !loading && (
            <button class="btn-icon btn-icon--lg" aria-label="Close" onClick={onClose}>
              <X class="lucide-icon" />
            </button>
          )}
        </div>
        <div class="projects-view-body">
          {/* A stale error from a prior attempt is no longer current once a
              new load starts — drop it rather than showing it next to the
              new attempt's progress. */}
          {pv.opts.error && !loading && <div class="card-error">{pv.opts.error}</div>}
          {loading && scan ? (
            <div class="projects-view-progress" role="status" aria-live="polite">
              {PENDING_SOURCE_LABEL.value && (
                <div class="loading-pending-label">{PENDING_SOURCE_LABEL.value}</div>
              )}
              <div class="loading-spinner" />
              <div class="text-card-title is-loading">
                {LOADING_STEP_LABELS[stepForPhase(scan.phase, scan.kind)]}
                {'…'}
              </div>
              <button type="button" class="btn-primary" onClick={onCancel}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <NewProjectForm
                allowLocalRepos={SERVER_CONFIG.value.allowLocalRepos}
                prefill={pv.opts.prefill}
                onSubmit={onSubmit}
              />
              <RecentsList onOpen={onSubmit} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
