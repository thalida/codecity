// layout/AppHeader.tsx — Sitewide top header. Composition shell only.
//
// The header is the PROJECT; the footer is the APP. Everything here is about
// the repo you have open: which one it is (gem + name + branch), what you can
// do with its address, and how fresh it is. Two clusters, each outlined as a
// group: see .chrome-cluster.

import './AppHeader.css';
import { DatabaseZap, ExternalLink, RefreshCw } from 'lucide-preact';
import { SOURCE_INFO } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import type { Manifest } from '@/types';
import { openProjectsView } from '@/state/stores/ui';
import { ChromeCluster, ClusterLink } from '@/components/ChromeCluster/ChromeCluster';
import { ProjectSwitcher } from '@/components/ProjectSwitcher/ProjectSwitcher';
import { CopyButton } from '@/components/CopyButton/CopyButton';
import { FreshnessStatus } from '@/components/FreshnessStatus/FreshnessStatus';
import { SplitButton } from '@/components/SplitButton/SplitButton';
import { AutoRefreshRow } from '@/components/AutoRefreshRow/AutoRefreshRow';

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
      <ChromeCluster>
        <ProjectSwitcher
          rootLabel={si.label}
          branch={si.branch}
          onSwitchSource={onSwitchSource ?? (() => openProjectsView({ dismissible: true }))}
        />
        {si.src && <CopyButton variant="cluster" text={si.src} label="Copy repo source" />}
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
          <FreshnessStatus />
          {/* Same copy whichever kind of source is loaded. "Check for changes"
              is honest whether that means stat-walking a working tree or
              fetching a remote, and which one it is is mechanism the menu has
              no business narrating. */}
          <SplitButton
            variant="chrome"
            // Glyph only: in a 32px bar the word costs more room than it earns,
            // and the status readout beside it already says what it acts on.
            iconOnly
            label="Refresh"
            icon={RefreshCw}
            onPrimary={() => onRefresh?.(false)}
            menuLabel="More refresh options"
            items={[
              {
                id: 'refresh',
                icon: RefreshCw,
                label: 'Refresh',
                sublabel: 'check for changes and re-scan if anything moved',
                onSelect: () => onRefresh?.(false),
              },
              {
                id: 'fresh',
                icon: DatabaseZap,
                label: 'Fresh scan',
                sublabel: 'ignore the cache and re-read the whole repo',
                onSelect: () => onRefresh?.(true),
              },
            ]}
            footer={<AutoRefreshRow />}
          />
        </ChromeCluster>
      )}
    </header>
  );
}
