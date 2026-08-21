// chrome/CityFooter — the app's own bar. The header is the project; nothing
// here is about the repo you have open. Per-node stats live in the selection
// pane's footer, beside the thing they describe.

import './CityFooter.css';
import { ChromeCluster } from '@/views/CityView/chrome/ChromeCluster/ChromeCluster';
import { AppearanceMenu } from '@/components/menus/AppearanceMenu/AppearanceMenu';
import { ImportExportMenu } from '@/components/menus/ImportExportMenu/ImportExportMenu';
import { TRANSFER_GROUPS } from '@/views/CityView/chrome/CityFooter/transferGroups';
import { ShortcutsMenu } from '@/components/menus/ShortcutsMenu/ShortcutsMenu';
import { DebugMenu } from '@/components/menus/DebugMenu/DebugMenu';
import { isDebugMode } from '@/utils/debugMode';
import { MetaLine } from '@/components/app/MetaLine/MetaLine';

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
          <ImportExportMenu groups={TRANSFER_GROUPS} />
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
