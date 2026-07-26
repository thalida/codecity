// state/stores/serverConfig.ts — Runtime signal holding server capabilities
// fetched once during app boot. Written by useManifestSource after getServerConfig().
// Read by ProjectsView to decide whether to show the local-repos tab, and by the
// /api/images and /api/fingerprints batchers to size their requests.

import { signal } from '@preact/signals';
import type { components } from '@/types/manifest.generated';

// Derived from the OpenAPI schema rather than re-declared, so a field added to
// the backend's ConfigResponse cannot drift from what this store exposes.
export type ServerConfig = components['schemas']['ConfigResponse'];

// Pre-boot defaults, replaced by the real /api/config response. maxBatchPaths
// starts low because guessing high fails silently: the batch routes truncate
// anything past their cap, so an over-large chunk loses its tail. Guessing low
// only costs an extra request.
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowLocalRepos: false,
  maxBatchPaths: 16,
};

export const SERVER_CONFIG = signal<ServerConfig>(DEFAULT_SERVER_CONFIG);
