// layout/AppHeader.tsx — Sitewide top header. Composition shell only: the reset
// gem stays at the left edge; the project switcher + its actions (copy-source,
// open-on-origin) sit centered. What's selected is shown in the right sidebar
// (open whenever there's a selection), not here.

import './AppHeader.css';
import { ExternalLink } from 'lucide-preact';
import { SOURCE_INFO } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import type { Manifest } from '@/types';
import { openProjectsView } from '@/state/stores/ui';
import { ResetViewButton } from '@/components/ResetViewButton';
import { ProjectSwitcher } from '@/components/ProjectSwitcher/ProjectSwitcher';
import { CopyButton } from '@/components/CopyButton/CopyButton';

export interface AppHeaderProps {
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
  /** Fires when the user clicks the reset-view (gem) button. */
  onResetView?: () => void;
}

export function AppHeader({ onSwitchSource, onResetView }: AppHeaderProps = {}) {
  const si = SOURCE_INFO.value;
  const remoteUrl = (MANIFEST.value as Manifest)?.repo?.remote_url ?? null;

  return (
    <header id="app-header" class="surface-chrome">
      <div id="app-header-left">
        <ResetViewButton onResetView={onResetView} />
      </div>
      <div id="app-title">
        <ProjectSwitcher
          rootLabel={si.label}
          branch={si.branch}
          onSwitchSource={onSwitchSource ?? (() => openProjectsView({ dismissible: true }))}
        />
        {si.src && <CopyButton text={si.src} label="Copy repo source" />}
        {remoteUrl && (
          <a
            class="btn-icon btn-icon--link btn-icon--no-drag"
            href={remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the repo on its origin remote"
            aria-label="Open repo on origin"
          >
            <ExternalLink class="icon" />
          </a>
        )}
      </div>
    </header>
  );
}
