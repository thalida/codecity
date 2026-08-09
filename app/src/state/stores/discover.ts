// Reactive mirror of the curated Discover list fetched at boot. Shape lives in
// @/api/discover, which must not depend on this layer.

import { signal } from '@preact/signals';
import type { DiscoverEntry } from '@/api/discover';

export type { DiscoverEntry };

// Empty until the fetch lands, and empty forever if the server has Discover
// switched off. The tab keys its own visibility off this being non-empty, so
// there is no separate "loaded yet?" flag to keep in step.
export const DISCOVER = signal<readonly DiscoverEntry[]>([]);
