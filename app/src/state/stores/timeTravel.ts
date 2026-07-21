// state/stores/timeTravel.ts — View state: which past commit the city is
// pinned to (null = live HEAD). Deliberately NOT part of CURRENT_SOURCE —
// you're viewing the same repo in the past, so recents/the source chip stay
// put and the live-update poll (which reads CURRENT_SOURCE, not this) yields
// instead of pulling HEAD back in underneath the pinned view.

import { signal } from '@preact/signals';

export const TIME_TRAVEL_REF = signal<string | null>(null);
