// Rendering something that reads the server's description of itself.
//
// That is server state, held in a query cache rather than a signal, so a test
// seeds the cache the way a landed fetch would — no network, no waiting.

import { render, type ComponentChildren } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SERVER_CONFIG, type DiscoverEntry, type ServerConfig } from '@codecity/city';

export interface ServerSeed {
  config?: Partial<ServerConfig>;
  discover?: readonly DiscoverEntry[];
}

/** Render `ui` with the server reads already answered. */
export function renderWithServer(
  ui: ComponentChildren,
  host: HTMLElement,
  seed: ServerSeed = {}
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['server-config'], { ...DEFAULT_SERVER_CONFIG, ...seed.config });
  client.setQueryData(['discover'], seed.discover ?? []);
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, host);
  return client;
}
