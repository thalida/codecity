// state/queryClient.ts — the cache for what the SERVER tells us about itself.
//
// Server state, not UI state: signals hold what this app decides, this holds
// what it was told. The manifest is neither — it is the city's, and it streams.

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The server's own description of itself does not change under a reader.
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
