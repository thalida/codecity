// views/CityView — what `/city` renders: the city, flyable and pickable in the
// center pane, and the chrome that belongs to it. Everything city-shaped mounts
// here rather than at the root: the URL⇄view binding, the selection announcer,
// and the syntax theme the file preview reads.

import './CityView.css';
import { useEffect } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';

import { CityHeader } from './chrome/CityHeader/CityHeader';
import { CityFooter } from './chrome/CityFooter/CityFooter';
import { CityStage } from './chrome/CityStage/CityStage';
import { CitySidebarLeft } from './chrome/CitySidebarLeft/CitySidebarLeft';
import { CitySidebarRight } from './chrome/CitySidebarRight/CitySidebarRight';
import { LoadingOverlay } from '@/components/loading/LoadingOverlay/LoadingOverlay';
import { HljsThemeLink } from '@/views/CityView/HljsThemeLink/HljsThemeLink';
import { SelectionAnnouncer } from '@/views/CityView/SelectionAnnouncer/SelectionAnnouncer';
import { useShortcutsKey } from '@/hooks/useShortcutsKey';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { clearSourceUrl } from '@/router/urlBinding';
import { useProject } from '@/state/project/context';

export function CityView() {
  const session = useProject();
  const { source, progress, commands, load } = session;
  // The panel it opens lives in this view's footer, so the key belongs here.
  useShortcutsKey();
  // A newly loaded source has nothing selected in it yet.
  useSignalEffect(() => {
    if (source.current.value) commands.clearSelection();
  });

  const onCancelLoad = () => {
    // A load with something to go back to registers its own handler; one with
    // nothing to go back to leaves the URL describing what it just called off.
    const registered = progress.cancel.peek();
    if (registered) registered();
    else {
      load.cancel();
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
      <CityHeader onSwitchSource={() => navigate(ROUTES.HOME)} onRefresh={load.refresh} />
      <main id="city-body" tabIndex={-1}>
        <CitySidebarLeft />
        <CityStage />
        <CitySidebarRight />
      </main>
      <CityFooter
        onRunCollisionCheck={commands.runCollisionCheck}
        onRunStemDiagnostic={commands.runStemDiagnostic}
        onRunTreeGroundingCheck={commands.runTreeGroundingCheck}
      />
      {/* Belongs to this route: a load started from the landing shows its
          progress there, in the card it was started from. */}
      <LoadingOverlay onCancel={onCancelLoad} />
      <HljsThemeLink />
      <SelectionAnnouncer />
    </>
  );
}
