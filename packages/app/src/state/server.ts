// state/server.ts — what the server told us about itself at boot:
// how it is configured, and the repos it offers to show you. Fetched once, never
// written by the app. Both shapes live in @/api, which must not depend on this.

import { DEFAULT_SERVER_CONFIG, ServerConfig } from '@codecity/city';
import { signal } from '@preact/signals';

export type { ServerConfig };
export { DEFAULT_SERVER_CONFIG };

export const SERVER_CONFIG = signal<ServerConfig>(DEFAULT_SERVER_CONFIG);

// Empty until the fetch lands, and forever if Discover is off. The tab keys its
// visibility off that, so there is no "loaded yet?" flag to keep in step.
