// api/reads.ts — what the server says about itself, as queries.
//
// Server state, not UI state: fetched, cached, with a loading and error state of
// its own. The manifest is neither — it streams, and it is the city's.

import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SERVER_CONFIG, type DiscoverEntry, type ServerConfig } from '@codecity/city';

import { API } from '@/api/client';

/** The server's configuration, with its defaults until the read lands. */
export function useServerConfig(): ServerConfig {
  const { data } = useQuery({ queryKey: ['server-config'], queryFn: () => API.getServerConfig() });
  return data ?? DEFAULT_SERVER_CONFIG;
}

const NO_DISCOVER: readonly DiscoverEntry[] = [];

/** What the server offers to open, empty until the read lands. */
export function useDiscover(): readonly DiscoverEntry[] {
  const { data } = useQuery({ queryKey: ['discover'], queryFn: () => API.getDiscover() });
  return data ?? NO_DISCOVER;
}
