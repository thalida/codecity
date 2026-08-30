// state/server.ts — what the server told us about itself at boot: how it is
// configured. App-wide, because the footer names the version on every route.

import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '@codecity/city';

import { API } from '@/apiClient';

export const SERVER_CONFIG_KEY = ['server-config'] as const;

/** The server's configuration, with its defaults until the read lands. */
export function useServerConfig(): ServerConfig {
  const { data } = useQuery({
    queryKey: SERVER_CONFIG_KEY,
    queryFn: () => API.getServerConfig(),
  });
  return data ?? DEFAULT_SERVER_CONFIG;
}
