// hooks/useServerData.ts — the two boot reads that describe the SERVER, not a
// city: what it is configured with, and what it offers to open.
//
// Genuinely app-global, and the only thing left of what used to be the fetch
// layer: loading a repo is now <City>'s `src` prop, and the city reports its
// own progress.

import { useEffect } from 'preact/hooks';

import { DISCOVER, SERVER_CONFIG } from '@/state/stores/serverData';
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
