// One-shot memoized fetch of /api/config. Failures fail closed: better the
// "local is disabled" UI than a path input the server will reject.

import { apiUrl } from '@/api/apiUrl';
import type { components } from '@/types/manifest.generated';

// Derived from the OpenAPI schema rather than re-declared, so a field added to
// the backend's ConfigResponse cannot drift from what this layer exposes.
export type ServerConfig = components['schemas']['ConfigResponse'];

// Pre-boot defaults. `version` matches the backend's own metadata-lookup
// fallback.
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowLocalRepos: false,
  hosted: false,
  featuredRepo: '',
  version: '0.0.0+unknown',
};

let _cached: Promise<ServerConfig> | null = null;

export async function fetchServerConfig(): Promise<ServerConfig> {
  try {
    const resp = await fetch(apiUrl('config'));
    if (!resp.ok) return DEFAULT_SERVER_CONFIG;
    const body = (await resp.json()) as Partial<ServerConfig>;
    // Over the defaults, overriding only what the body actually carries, so a
    // truncated or half-written response can't zero a field to its falsy value.
    return {
      ...DEFAULT_SERVER_CONFIG,
      allowLocalRepos: !!body.allowLocalRepos,
      hosted: !!body.hosted,
      ...(typeof body.featuredRepo === 'string' ? { featuredRepo: body.featuredRepo } : {}),
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
  if (_cached === null) _cached = fetchServerConfig();
  return _cached;
}

/** Test-only: clear the memoized promise so successive tests can
 *  return different responses without leaking state. */
export function _resetServerConfigForTests(): void {
  _cached = null;
}
