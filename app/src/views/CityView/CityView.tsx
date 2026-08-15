// views/CityView — what `/city` renders: the city and the chrome that belongs
// to it. <City /> lives in the center pane here, flyable and pickable, which is
// the whole difference between this view and the landing's use of it.

import { AppHeader } from '@/layout/AppHeader/AppHeader';
import { AppFooter } from '@/layout/AppFooter/AppFooter';
import { CenterPane } from '@/layout/CenterPane/CenterPane';
import { LeftSidebar } from '@/layout/LeftSidebar/LeftSidebar';
import { RightSidebar } from '@/layout/RightSidebar/RightSidebar';
import { LoadingOverlay } from '@/components/LoadingOverlay/LoadingOverlay';
import { runCollisionCheck, runStemDiagnostic, runTreeGroundingCheck } from '@/state/stores/scene';

export interface CityViewProps {
  onSwitchSource: () => void;
  onRefresh: (skipCache: boolean) => void;
  onCancelLoad: () => void;
}

export function CityView({ onSwitchSource, onRefresh, onCancelLoad }: CityViewProps) {
  return (
    <>
      <a class="skip-link" href="#app-body">
        Skip to content
      </a>
      {/* The header owns the control; which read a refresh means in the mode
          you are in is the fetch layer's call. */}
      <AppHeader onSwitchSource={onSwitchSource} onRefresh={onRefresh} />
      <main id="app-body" tabIndex={-1}>
        <LeftSidebar />
        <CenterPane />
        <RightSidebar />
      </main>
      <AppFooter
        onRunCollisionCheck={runCollisionCheck}
        onRunStemDiagnostic={runStemDiagnostic}
        onRunTreeGroundingCheck={runTreeGroundingCheck}
      />
      {/* Belongs to this route: a load started from the landing shows its
          progress there, in the card it was started from. */}
      <LoadingOverlay onCancel={onCancelLoad} />
    </>
  );
}
