// chrome/CityHeader — Sitewide top header, composition shell only. The
// header is the PROJECT; the footer is the APP. Everything here is about the
// repo you have open: which one it is, what you can do with its address, and
// how fresh it is. Two clusters, each outlined: see .chrome-cluster.

import { useSourceInfo } from '@/hooks/useSourceInfo';
import './CityHeader.css';
import { ExternalLink } from 'lucide-preact';

import { useCityManifest } from '@codecity/city/preact';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { IS_PHONE } from '@/state/viewport';
import { ChromeCluster } from '@/views/CityView/chrome/ChromeCluster/ChromeCluster';
import { ProjectSwitcher } from '@/components/sources/ProjectSwitcher/ProjectSwitcher';
import { CopyButton } from '@/components/buttons/CopyButton/CopyButton';
import { ScanMenu } from '@/components/menus/ScanMenu/ScanMenu';

export interface AppHeaderProps {
  /** Fires when the user clicks the project chip to switch source. */
  onSwitchSource?: () => void;
  /** Re-open the current source. `skipCache` ignores the server's cached scan
   *  and re-reads the repo from scratch. */
  onRefresh?: (skipCache: boolean) => void;
}

export function CityHeader({ onSwitchSource, onRefresh }: AppHeaderProps = {}) {
  const si = useSourceInfo();
  const remoteUrl = useCityManifest()?.repo?.remote_url ?? null;
  // Nothing loaded: the freshness cluster would be reporting on a project that
  // doesn't exist, and refresh would have nothing to re-open.
  const hasProject = Boolean(si.src);

  return (
    <header id="city-header" class="surface-chrome">
      <ChromeCluster class="city-header-project">
        <ProjectSwitcher
          rootLabel={si.label}
          branch={si.branch}
          src={si.src}
          onSwitchSource={onSwitchSource ?? (() => navigate(ROUTES.HOME))}
        />
        {/* Dropped on a phone: a repo path on a phone's clipboard has nowhere
            to go, and the room buys the repo name back. */}
        {si.src && !IS_PHONE.value && <CopyButton text={si.src} label="Copy repo source" />}
        {remoteUrl && (
          <a
            href={remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the repo on its origin remote"
            aria-label="Open repo on origin"
          >
            <ExternalLink class="icon" />
          </a>
        )}
      </ChromeCluster>

      {hasProject && (
        // Still a cluster around the one item: the outline is what makes it
        // read as a control rather than a line of status text.
        <ChromeCluster class="city-header-freshness">
          <ScanMenu onRefresh={onRefresh} />
        </ChromeCluster>
      )}
    </header>
  );
}
