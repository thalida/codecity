// Reactive mirror of the server config fetched at boot. Shape + defaults live
// in @/api/config, which must not depend on this layer.

import { signal } from '@preact/signals';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@/api/config';

export type { ServerConfig };
export { DEFAULT_SERVER_CONFIG };

export const SERVER_CONFIG = signal<ServerConfig>(DEFAULT_SERVER_CONFIG);
