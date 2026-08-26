// One-shot memoized fetch of /api/config. Failures fail closed: better the
// "local is disabled" UI than a path input the server will reject.

import type { components } from '@/types/manifest.generated';
import type { ApiUrl } from './url';

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

export function createConfigEndpoints(apiUrl: ApiUrl) {
  async function fetchServerConfig(): Promise<ServerConfig> {
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

  /** Read config from here: one network call, then the cached promise.
   *  `fetchServerConfig` is exposed only for tests wanting a fresh roundtrip. */
  function getServerConfig(): Promise<ServerConfig> {
    if (_cached === null) _cached = fetchServerConfig();
    return _cached;
  }

  /** Test-only: clear the memoized promise so successive tests can
   *  return different responses without leaking state. */
  function _resetServerConfigForTests(): void {
    _cached = null;
  }

  return {
    fetchServerConfig,
    getServerConfig,
    _resetServerConfigForTests,
  };
}
