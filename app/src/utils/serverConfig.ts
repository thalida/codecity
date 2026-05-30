// utils/serverConfig.ts — One-shot fetch of /api/config, memoized.
//
// Read once at boot in main.ts and passed into UI components that need
// to know server-side feature flags (currently: whether local-repo
// sources are permitted). Any fetch / parse failure fails closed —
// we prefer to render the "local is disabled" UI than to expose a
// path input that the server will reject anyway.

export interface ServerConfig {
  allowLocalRepos: boolean;
}

const DISABLED: ServerConfig = { allowLocalRepos: false };

let _cached: Promise<ServerConfig> | null = null;

export async function fetchServerConfig(): Promise<ServerConfig> {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return DISABLED;
    const body = (await resp.json()) as Partial<ServerConfig>;
    return { allowLocalRepos: !!body.allowLocalRepos };
  } catch (_) {
    return DISABLED;
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
