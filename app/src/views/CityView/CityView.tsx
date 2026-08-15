// views/CityView — what `/city` renders: the city, flyable and pickable in the
// center pane, and the chrome that belongs to it. Everything city-shaped mounts
// here rather than at the root: the URL⇄view binding, the selection announcer,
// and the syntax theme the file preview reads.

import './CityView.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';

import { CityHeader } from '@/chrome/CityHeader/CityHeader';
import { CityFooter } from '@/chrome/CityFooter/CityFooter';
import { CityStage } from '@/chrome/CityStage/CityStage';
import { LeftSidebar } from '@/chrome/LeftSidebar/LeftSidebar';
import { RightSidebar } from '@/chrome/RightSidebar/RightSidebar';
import { LoadingOverlay } from '@/components/LoadingOverlay/LoadingOverlay';
import { HljsThemeLink } from '@/components/HljsThemeLink/HljsThemeLink';
import { SelectionAnnouncer } from '@/components/SelectionAnnouncer/SelectionAnnouncer';
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { cancelLoad, refreshCurrentSource } from '@/hooks/useManifestSource';
import { attachViewUrlReactions } from '@/router/viewBinding';
import { goHome, LOADING_CANCEL } from '@/state/stores/ui';
import { CURRENT_SOURCE, clearSourceUrl } from '@/state/stores/source';
import {
  clearSelection,
  runCollisionCheck,
  runStemDiagnostic,
  runTreeGroundingCheck,
} from '@/state/stores/scene';

export function CityView() {
  // The panel it opens lives in this view's footer, so the key belongs here.
  useShortcutsKey();
  // Mode, scrub commit and selection are this view's: the landing has nothing
  // to describe, and reflecting there would write them onto `/`.
  useEffect(() => attachViewUrlReactions(), []);

  // A newly loaded source has nothing selected in it yet.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) clearSelection();
  });

  const onCancelLoad = () => {
    // A load with something to go back to registers its own handler; one with
    // nothing to go back to leaves the URL describing what it just called off.
    const registered = LOADING_CANCEL.peek();
    if (registered) registered();
    else {
      cancelLoad();
      clearSourceUrl();
    }
  };

  return (
    <>
      <a class="skip-link" href="#city-body">
        Skip to content
      </a>
      {/* The header owns the control; which read a refresh means in the mode
          you are in is the fetch layer's call. */}
      <CityHeader onSwitchSource={() => goHome()} onRefresh={refreshCurrentSource} />
      <main id="city-body" tabIndex={-1}>
        <LeftSidebar />
        <CityStage />
        <RightSidebar />
      </main>
      <CityFooter
        onRunCollisionCheck={runCollisionCheck}
        onRunStemDiagnostic={runStemDiagnostic}
        onRunTreeGroundingCheck={runTreeGroundingCheck}
      />
      {/* Belongs to this route: a load started from the landing shows its
          progress there, in the card it was started from. */}
      <LoadingOverlay onCancel={onCancelLoad} />
      <HljsThemeLink />
      <SelectionAnnouncer />
    </>
  );
}
