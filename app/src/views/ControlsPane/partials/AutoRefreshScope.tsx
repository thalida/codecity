// views/ControlsPane/partials/AutoRefreshScope.tsx — The Auto-refresh section's
// hint. Says which of the two states you are in, because the controls beneath it
// look identical either way: a remote source is cloned once and never re-fetched,
// so there is nothing for the poll to notice.

import { CURRENT_SOURCE_IS_LOCAL } from '@/state/stores/source';

export function AutoRefreshScope() {
  return CURRENT_SOURCE_IS_LOCAL.value ? (
    <>Watches this working tree and re-renders the city when its files change.</>
  ) : (
    <>Local projects only. This one is a clone, so its files never change on their own.</>
  );
}
