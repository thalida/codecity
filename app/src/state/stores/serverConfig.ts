// state/stores/serverConfig.ts — Runtime signal holding server capabilities
// fetched once during app boot. Written by bootApp() (boot.ts) after getServerConfig().
// Read by SourcePicker to decide whether to show the local-repos tab.

import { signal } from '@preact/signals';

export interface ServerConfig {
  allowLocalRepos: boolean;
}

export const SERVER_CONFIG = signal<ServerConfig>({ allowLocalRepos: false });
