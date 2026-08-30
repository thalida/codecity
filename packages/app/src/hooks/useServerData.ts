// hooks/useServerData.ts — the boot read that describes the SERVER, not a city:
// what it is configured with. Genuinely app-wide, and the only thing left of
// what used to be the fetch layer: loading a repo is <City>'s `src` prop now.

import { useEffect } from 'preact/hooks';

import { SERVER_CONFIG } from '@/state/server';
import { DISCOVER } from '@/views/HomeView/discover';
import { API } from '@/apiClient';

export function useServerData(): void {
  useEffect(() => {
    let cancelled = false;
    // Independent reads, so they go out together rather than making the
    // landing wait for two round trips in series.
    void Promise.all([API.getServerConfig(), API.getDiscover()]).then(([config, discover]) => {
      if (cancelled) return;
      SERVER_CONFIG.value = config;
      DISCOVER.value = discover;
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
