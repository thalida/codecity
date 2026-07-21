// Which past commit the city is pinned to (null = live HEAD). Separate from
// CURRENT_SOURCE so recents/the source chip stay put and the poll yields.

import { signal } from '@preact/signals';

export const TIME_TRAVEL_REF = signal<string | null>(null);
