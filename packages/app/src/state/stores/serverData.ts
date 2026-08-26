// state/stores/serverData.ts — what the server told us about itself at boot:
// how it is configured, and the repos it offers to show you. Fetched once, never
// written by the app. Both shapes live in @/api, which must not depend on this.

import { signal } from '@preact/signals';
import { DEFAULT_SERVER_CONFIG, DiscoverEntry, ServerConfig } from '@codecity/city';

export type { ServerConfig, DiscoverEntry };
export { DEFAULT_SERVER_CONFIG };

export const SERVER_CONFIG = signal<ServerConfig>(DEFAULT_SERVER_CONFIG);

// Empty until the fetch lands, and forever if Discover is off. The tab keys its
// visibility off that, so there is no "loaded yet?" flag to keep in step.
export const DISCOVER = signal<readonly DiscoverEntry[]>([]);
