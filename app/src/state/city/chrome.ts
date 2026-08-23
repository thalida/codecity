// state/city/chrome.ts — codecity's answer to what a city asks of the app it is
// mounted in: which pane opens, which drawer closes, and whether a modal has
// the keyboard. The city layer knows only the interface (see city/types).

import { IS_PHONE } from '@/state/stores/viewport';
import {
  OVERLAY_OPEN,
  SIDEBAR_COLLAPSED,
  dismissSelectionPane,
  openSelectionPane,
} from '@/state/stores/chrome';
import type { CityChrome } from '@/city/types';

export class SessionChrome implements CityChrome {
  keyboardBusy = (): boolean => OVERLAY_OPEN.value;

  /** You asked for the node by name, so its details are the answer, and only
   *  the phone drawer has to move. */
  showDetails = (): void => {
    openSelectionPane();
    this.collapseDrawerOnPhone();
  };

  /** The other half of that choice: you asked to see the city, so what is in
   *  the way goes, and the chip stands in for the details. */
  revealCity = (): void => {
    dismissSelectionPane();
    this.collapseDrawerOnPhone();
  };

  /** Phone: the left drawer covers the city, so a camera move behind it is one
   *  you can't see. It is the whole screen there and a column everywhere else. */
  private collapseDrawerOnPhone(): void {
    if (IS_PHONE.peek()) SIDEBAR_COLLAPSED.value = true;
  }
}
