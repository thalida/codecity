// chrome/CityFooter — the app's own bar. The header is the project; nothing
// here is about the repo you have open. Per-node stats live in the selection
// pane's footer, beside the thing they describe.

import './CityFooter.css';
import { ChromeCluster } from '@/components/ChromeCluster/ChromeCluster';
import { AppearanceMenu } from '@/components/AppearanceMenu/AppearanceMenu';
import { ShortcutsMenu } from '@/components/ShortcutsMenu/ShortcutsMenu';
import { DebugMenu } from '@/components/DebugMenu/DebugMenu';
import { isDebugMode } from '@/utils/debugMode';
import { MetaLine } from '@/components/AppMeta/AppMeta';

export interface AppFooterProps {
  onRunCollisionCheck?: () => void;
  onRunStemDiagnostic?: () => void;
  onRunTreeGroundingCheck?: () => void;
}

export function CityFooter({
  onRunCollisionCheck,
  onRunStemDiagnostic,
  onRunTreeGroundingCheck,
}: AppFooterProps = {}) {
  return (
    <footer id="city-footer" class="surface-chrome">
      <div class="app-footer-section app-footer-left">
        <ChromeCluster>
          <AppearanceMenu />
          <ShortcutsMenu />
          {isDebugMode() && (
            <DebugMenu
              onRunCollisionCheck={onRunCollisionCheck}
              onRunStemDiagnostic={onRunStemDiagnostic}
              onRunTreeGroundingCheck={onRunTreeGroundingCheck}
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
