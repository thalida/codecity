// city/viewState.ts — everything about WHERE you are in a city, as one value
// you can write down and hand back.
//
// A host that wants a shareable link, a restored session or an undo stack needs
// exactly this, and without it each one writes its own: our own app spends
// router/viewBinding.ts and router/viewParams.ts serialising the selection and
// the scrub position into the URL by hand, which is a snapshot API written by
// the consumer because the package had none.
//
// Deliberately NOT the settings. Those are values the host already owns and
// persists; this is the part of a city's state that the city itself holds.

import type { PickerSelectionKey } from './types/picker';

/** Where you are in a city. Plain data: JSON in, JSON out, no class, nothing
 *  that has to be alive to be meaningful. Every field is optional, and an
 *  absent one means "leave this as it is" on the way back in — so a host that
 *  only cares about the selection writes only the selection. */
export interface CityViewState {
  /** What is selected, by identity rather than by mesh, so it survives the
   *  rebuild between writing it down and reading it back. */
  selection?: PickerSelectionKey | null;
  /** Timeline: whether it is on, and where the scrubber sits. Absent when the
   *  city is showing HEAD. */
  timeline?: {
    mode: boolean;
    /** A float commit index — the scrub interpolates between commits. */
    pos: number;
  } | null;
}
