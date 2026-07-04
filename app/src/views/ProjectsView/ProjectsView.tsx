// views/ProjectsView/ProjectsView.tsx — full-viewport project switcher. Reads
// PROJECTS_VIEW + SERVER_CONFIG for open-state/prefill; App owns
// onSubmit/onCancel/onClose. Renders null when closed so the form/list state
// resets on next open. Replaces the old modal SourcePicker.

import './ProjectsView.css';
import { useEffect } from 'preact/hooks';
import { X } from 'lucide-preact';
import { PROJECTS_VIEW, type SourcePayload } from '@/state/stores/ui';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { NewProjectForm } from './NewProjectForm';
import { RecentsList } from './RecentsList';

export interface ProjectsViewProps {
  onSubmit: (payload: SourcePayload) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function ProjectsView({ onSubmit, onCancel, onClose }: ProjectsViewProps) {
  const pv = PROJECTS_VIEW.value;
  const loading = SCAN_PROGRESS.value !== null;

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
          {pv.opts.error && <div class="card-error">{pv.opts.error}</div>}
          <NewProjectForm
            allowLocalRepos={SERVER_CONFIG.value.allowLocalRepos}
            prefill={pv.opts.prefill}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
          <RecentsList onOpen={onSubmit} />
        </div>
      </div>
    </div>
  );
}
