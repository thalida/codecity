// api/config.ts — One-shot fetch of /api/config, memoized.
//
// Read once at boot in useManifestSource and passed into UI components that need
// to know server-side feature flags (currently: whether local-repo
// sources are permitted). Any fetch / parse failure fails closed —
// we prefer to render the "local is disabled" UI than to expose a
// path input that the server will reject anyway.

import { apiUrl } from '@/api/apiUrl';
import type { components } from '@/types/manifest.generated';

// Derived from the OpenAPI schema rather than re-declared, so a field added to
// the backend's ConfigResponse cannot drift from what this layer exposes.
export type ServerConfig = components['schemas']['ConfigResponse'];

// Pre-boot defaults, replaced by the real /api/config response. maxBatchPaths
// starts low because guessing high fails silently: the batch routes truncate
// anything past their cap, so an over-large chunk loses its tail. Guessing low
// only costs an extra request.
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowLocalRepos: false,
  maxBatchPaths: 16,
};

let _cached: Promise<ServerConfig> | null = null;
// The resolved value, for callers that need it synchronously mid-request (the
// batch coalescers). Not a second source of truth: it is written only from the
// memoized fetch below, which is the same one the SERVER_CONFIG signal mirrors.
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
    // Spread over the defaults rather than re-projecting field by field: the
    // old shape listed each key by hand, so a field added on the server was
    // silently dropped here. Only override what the body actually carries, so
    // a truncated response can't yield a zero batch size.
    return {
      ...DEFAULT_SERVER_CONFIG,
      allowLocalRepos: !!body.allowLocalRepos,
      ...(typeof body.maxBatchPaths === 'number' && body.maxBatchPaths > 0
        ? { maxBatchPaths: body.maxBatchPaths }
        : {}),
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
