// layout/AppHeader.tsx — Sitewide top header. Composition shell only.
//
// The header is the PROJECT; the footer is the APP. Everything here is about
// the repo you have open: which one it is (gem + name + branch), what you can
// do with its address, and how fresh it is. Two clusters, each outlined as a
// group: see .chrome-cluster.

import './AppHeader.css';
import { ExternalLink, RefreshCw } from 'lucide-preact';
import { SOURCE_INFO } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import type { Manifest } from '@/types';
import { openProjectsView } from '@/state/stores/ui';
import { IS_PHONE } from '@/state/stores/viewport';
import {
  ChromeCluster,
  ClusterButton,
  ClusterLink,
} from '@/components/ChromeCluster/ChromeCluster';
import { ProjectSwitcher } from '@/components/ProjectSwitcher/ProjectSwitcher';
import { CopyButton, CopyButtonVariant } from '@/components/CopyButton/CopyButton';
import { ScanMenu } from '@/components/ScanMenu/ScanMenu';

export interface AppHeaderProps {
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
  /** Re-open the current source. `skipCache` ignores the server's cached scan
   *  and re-reads the repo from scratch. */
  onRefresh?: (skipCache: boolean) => void;
}

export function AppHeader({ onSwitchSource, onRefresh }: AppHeaderProps = {}) {
  const si = SOURCE_INFO.value;
  const remoteUrl = (MANIFEST.value as Manifest)?.repo?.remote_url ?? null;
  // Nothing loaded: the freshness cluster would be reporting on a project that
  // doesn't exist, and refresh would have nothing to re-open.
  const hasProject = Boolean(si.src);

  return (
    <header id="app-header" class="surface-chrome">
      <ChromeCluster class="app-header-project">
        <ProjectSwitcher
          rootLabel={si.label}
          branch={si.branch}
          onSwitchSource={onSwitchSource ?? (() => openProjectsView({ dismissible: true }))}
        />
        {/* Dropped on a phone: a repo path on a phone's clipboard has nowhere
            to go, and the room buys the repo name back. */}
        {si.src && !IS_PHONE.value && (
          <CopyButton variant={CopyButtonVariant.Cluster} text={si.src} label="Copy repo source" />
        )}
        {remoteUrl && (
          <ClusterLink
            href={remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the repo on its origin remote"
            aria-label="Open repo on origin"
          >
            <ExternalLink class="icon" />
          </ClusterLink>
        )}
      </ChromeCluster>

      {hasProject && (
        <ChromeCluster class="app-header-freshness">
          <ScanMenu onFreshScan={() => onRefresh?.(true)} />
          {/* Beside the menu, not inside it: the menu lists what this button
              isn't, and the common case stays one press. */}
          <ClusterButton title="Refresh" aria-label="Refresh" onClick={() => onRefresh?.(false)}>
            <RefreshCw class="icon" />
          </ClusterButton>
        </ChromeCluster>
      )}
    </header>
  );
}
