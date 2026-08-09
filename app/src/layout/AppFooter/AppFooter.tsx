// layout/AppFooter.tsx — Sitewide bottom status bar.
//
// The header is the PROJECT; the footer is the APP. Nothing here is about the
// repo you have open: the keyboard shortcuts, the debug tools when debug mode
// is on, and the app's own line of version, about and credit. Freshness and
// refresh moved up to the header, next to the project they describe.
//
// Per-node stats live in the selection pane's own footer (<PaneStats>), beside
// the file or road they describe.

import './AppFooter.css';
import { Bug, Keyboard } from 'lucide-preact';
import { ChromeCluster, ClusterButton } from '@/components/ChromeCluster/ChromeCluster';
import { openDebug, openShortcuts } from '@/state/stores/ui';
import { isDebugMode } from '@/utils/debugMode';
import { MetaLine } from '@/components/AppMeta/AppMeta';

export function AppFooter() {
  return (
    <footer id="app-footer" class="surface-chrome">
      <div class="app-footer-section app-footer-left">
        <ChromeCluster>
          <ClusterButton
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            onClick={openShortcuts}
          >
            <Keyboard class="icon" />
          </ClusterButton>
          {isDebugMode() && (
            <ClusterButton title="Debug tools" aria-label="Debug tools" onClick={openDebug}>
              <Bug class="icon" />
            </ClusterButton>
          )}
        </ChromeCluster>
      </div>
      <div class="app-footer-section app-footer-right">
        <MetaLine linkClass="link--chrome" />
      </div>
    </footer>
  );
}
