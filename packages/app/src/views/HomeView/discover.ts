// views/HomeView/discover.ts — the repos this server offers to show you. Only
// the landing lists them, so only the landing asks for them.

import { useQuery } from '@tanstack/react-query';
import type { DiscoverEntry } from '@codecity/city';

import { API } from '@/apiClient';

const NONE: readonly DiscoverEntry[] = [];

/** What the server offers to open, empty until the read lands. */
export function useDiscover(): readonly DiscoverEntry[] {
  const { data } = useQuery({ queryKey: ['discover'], queryFn: () => API.getDiscover() });
  return data ?? NONE;
}
