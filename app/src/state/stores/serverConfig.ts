// state/stores/serverConfig.ts — Runtime signal holding server capabilities
// fetched once during app boot. Written by useManifestSource after getServerConfig().
// Read by ProjectsView to decide whether to show the local-repos tab.
//
// The shape and defaults live in @/api/config: that is the layer that speaks to
// the server, and it must not depend on this one. This store is the reactive
// mirror for the UI.

import { signal } from '@preact/signals';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@/api/config';

export type { ServerConfig };
export { DEFAULT_SERVER_CONFIG };

export const SERVER_CONFIG = signal<ServerConfig>(DEFAULT_SERVER_CONFIG);
