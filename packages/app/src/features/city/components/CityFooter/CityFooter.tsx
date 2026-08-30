// chrome/CityFooter — the app's own bar. The header is the project; nothing
// here is about the repo you have open. Per-node stats live in the selection
// pane's footer, beside the thing they describe.

import './CityFooter.css';
import { ChromeCluster } from '@/features/city/components/ChromeCluster/ChromeCluster';
import { AppearanceMenu } from '@/features/city/components/AppearanceMenu/AppearanceMenu';
import { ImportExportMenu } from '@/features/city/components/ImportExportMenu/ImportExportMenu';
import { TRANSFER_GROUPS } from '@/features/city/components/CityFooter/transferGroups';
import { ShortcutsMenu } from '@/features/city/components/ShortcutsMenu/ShortcutsMenu';
import { DebugMenu } from '@/features/city/components/DebugMenu/DebugMenu';
import { isDebugMode } from '@/utils/debugMode';
import { MetaLine } from '@/components/MetaLine/MetaLine';

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
