// state/stores/serverData.ts — what the server told us about itself at boot:
// how it is configured, and the repos it offers to show you. Fetched once, never
// written by the app. Both shapes live in @/api, which must not depend on this.

import { signal } from '@preact/signals';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@/api/config';
import type { DiscoverEntry } from '@/api/discover';
import { useEffect } from 'preact/hooks';
import { getServerConfig } from '@/api/config';
import { getDiscover } from '@/api/discover';

export type { ServerConfig, DiscoverEntry };
export { DEFAULT_SERVER_CONFIG };

export const SERVER_CONFIG = signal<ServerConfig>(DEFAULT_SERVER_CONFIG);

// Empty until the fetch lands, and forever if Discover is off. The tab keys its
// visibility off that, so there is no "loaded yet?" flag to keep in step.
export const DISCOVER = signal<readonly DiscoverEntry[]>([]);

/** The two boot reads the whole app shares, together rather than in series. */
export function useServerData(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [config, discover] = await Promise.all([getServerConfig(), getDiscover()]);
      if (cancelled) return;
      SERVER_CONFIG.value = config;
      DISCOVER.value = discover;
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
