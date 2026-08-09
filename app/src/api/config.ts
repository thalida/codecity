// One-shot memoized fetch of /api/config. Failures fail closed: better the
// "local is disabled" UI than a path input the server will reject.

import { apiUrl } from '@/api/apiUrl';
import type { components } from '@/types/manifest.generated';

// Derived from the OpenAPI schema rather than re-declared, so a field added to
// the backend's ConfigResponse cannot drift from what this layer exposes.
export type ServerConfig = components['schemas']['ConfigResponse'];

// Pre-boot defaults. maxBatchPaths guesses low: too high silently truncates a
// batch's tail, too low only costs an extra request. `version` matches the
// backend's own metadata-lookup fallback.
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowLocalRepos: false,
  hosted: false,
  featuredRepo: '',
  maxBatchPaths: 16,
  version: '0.0.0+unknown',
};

let _cached: Promise<ServerConfig> | null = null;
// For synchronous mid-request readers (the batch coalescers); written only by
// the memoized fetch below, so never a second source of truth.
let _resolved: ServerConfig = DEFAULT_SERVER_CONFIG;

/** The server config as last resolved, or the defaults before boot completes. */
export function serverConfigNow(): ServerConfig {
  return _resolved;
}

export async function fetchServerConfig(): Promise<ServerConfig> {
  try {
    const resp = await fetch(apiUrl('config'));
    if (!resp.ok) return DEFAULT_SERVER_CONFIG;
    const body = (await resp.json()) as Partial<ServerConfig>;
    // Spread over the defaults (a hand-listed shape drops server-added fields);
    // override only what the body carries so a truncated response can't zero it.
    return {
      ...DEFAULT_SERVER_CONFIG,
      allowLocalRepos: !!body.allowLocalRepos,
      hosted: !!body.hosted,
      ...(typeof body.featuredRepo === 'string' ? { featuredRepo: body.featuredRepo } : {}),
      ...(typeof body.maxBatchPaths === 'number' && body.maxBatchPaths > 0
        ? { maxBatchPaths: body.maxBatchPaths }
        : {}),
      ...(typeof body.version === 'string' && body.version ? { version: body.version } : {}),
    };
  } catch (_) {
    return DEFAULT_SERVER_CONFIG;
  }
}

/**
 * Memoized variant. First call hits the network; subsequent calls
 * return the cached promise. Use this from the picker and anywhere
 * else that reads config — `fetchServerConfig` is exposed only for
 * tests that want a fresh roundtrip.
 */
export function getServerConfig(): Promise<ServerConfig> {
  if (_cached === null) {
    _cached = fetchServerConfig().then((cfg) => {
      _resolved = cfg;
      return cfg;
    });
  }
  return _cached;
}

/** Test-only: clear the memoized promise so successive tests can
 *  return different responses without leaking state. */
export function _resetServerConfigForTests(): void {
  _cached = null;
  _resolved = DEFAULT_SERVER_CONFIG;
}
