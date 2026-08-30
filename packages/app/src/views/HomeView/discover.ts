// views/HomeView/discover.ts — the repos this server offers to show you. Only
// the landing lists them, so only the landing knows about them.

import { signal } from '@preact/signals';
import type { DiscoverEntry } from '@codecity/city';

export const DISCOVER = signal<readonly DiscoverEntry[]>([]);
