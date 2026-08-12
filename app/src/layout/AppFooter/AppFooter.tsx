// layout/AppFooter.tsx — Sitewide bottom status bar.
//
// The header is the PROJECT; the footer is the APP. Nothing here is about the
// repo you have open: how the app looks, the keyboard reference, the debug
// tools when debug mode is on, and the app's own line of version and credit.
//
// Per-node stats live in the selection pane's own footer (<PaneStats>), beside
// the file or road they describe.

import './AppFooter.css';
import { ChromeCluster } from '@/components/ChromeCluster/ChromeCluster';
import { AppearanceMenu } from '@/components/AppearanceMenu/AppearanceMenu';
import { ShortcutsMenu } from '@/components/ShortcutsMenu/ShortcutsMenu';
import { DebugMenu } from '@/components/DebugMenu/DebugMenu';
import { isDebugMode } from '@/utils/debugMode';
import { MetaLine } from '@/components/AppMeta/AppMeta';

export interface AppFooterProps {
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
}

export function AppFooter({ onRunCollisionCheck, onRunStemDiagnostic }: AppFooterProps = {}) {
  return (
    <footer id="app-footer" class="surface-chrome">
      <div class="app-footer-section app-footer-left">
        <ChromeCluster>
          <AppearanceMenu />
          <ShortcutsMenu />
          {isDebugMode() && (
            <DebugMenu
              onRunCollisionCheck={onRunCollisionCheck}
              onRunStemDiagnostic={onRunStemDiagnostic}
            />
          )}
        </ChromeCluster>
      </div>
      <div class="app-footer-section app-footer-right">
        <MetaLine linkClass="link--chrome" />
      </div>
    </footer>
  );
}
