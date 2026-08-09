// layout/AppHeader.tsx — Sitewide top header. Composition shell only. Left: the
// project switcher (gem + name + branch) and its actions (copy-source,
// open-on-origin), all about the project you have open. Right: the meta any
// user might want, about and the keyboard shortcuts. Developer-only tools and
// run-state live in the footer instead; what's selected is shown in the right
// sidebar (open whenever there's a selection).

import './AppHeader.css';
import { ExternalLink, Keyboard } from 'lucide-preact';
import { SOURCE_INFO } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import type { Manifest } from '@/types';
import { openProjectsView, openShortcuts } from '@/state/stores/ui';
import { MetaAbout } from '@/components/AppMeta/AppMeta';
import { ProjectSwitcher } from '@/components/ProjectSwitcher/ProjectSwitcher';
import { CopyButton } from '@/components/CopyButton/CopyButton';

export interface AppHeaderProps {
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
}

export function AppHeader({ onSwitchSource }: AppHeaderProps = {}) {
  const si = SOURCE_INFO.value;
  const remoteUrl = (MANIFEST.value as Manifest)?.repo?.remote_url ?? null;

  return (
    <header id="app-header" class="surface-chrome">
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
      <div id="app-header-meta">
        <MetaAbout linkClass="link--chrome" />
        <button
          type="button"
          class="btn-icon btn-icon--sm btn-icon--no-drag"
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
          onClick={openShortcuts}
        >
          <Keyboard class="icon" />
        </button>
      </div>
    </header>
  );
}
