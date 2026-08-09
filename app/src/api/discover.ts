// One-shot memoized fetch of /api/discover. Every failure resolves to an empty
// list rather than rejecting: Discover is one tab on the landing page, and the
// tab hides itself when the list is empty, so "couldn't fetch it" and "the
// server has it switched off" want the same handling.

import { apiUrl } from '@/api/apiUrl';
import type { components } from '@/types/manifest.generated';

// Derived from the OpenAPI schema rather than re-declared, so a field added to
// the backend's DiscoverEntry cannot drift from what this layer exposes.
export type DiscoverEntry = components['schemas']['DiscoverEntry'];
type DiscoverResponse = components['schemas']['DiscoverResponse'];

const EMPTY: readonly DiscoverEntry[] = [];

function usable(entry: DiscoverEntry): boolean {
  return Boolean(entry?.url) && Boolean(entry?.label);
}

export async function fetchDiscover(): Promise<readonly DiscoverEntry[]> {
  try {
    const resp = await fetch(apiUrl('discover'));
    if (!resp.ok) return EMPTY;
    const body = (await resp.json()) as Partial<DiscoverResponse>;
    if (!Array.isArray(body.repos)) return EMPTY;
    // A row with no URL has nothing to open and a row with no label has
    // nothing to click, so both are dropped rather than rendered blank.
    return body.repos.filter(usable);
  } catch (_) {
    return EMPTY;
  }
}

let _cached: Promise<readonly DiscoverEntry[]> | null = null;

/**
 * Memoized variant. First call hits the network; subsequent calls return the
 * cached promise. `fetchDiscover` is exposed only for tests that want a fresh
 * roundtrip.
 */
export function getDiscover(): Promise<readonly DiscoverEntry[]> {
  if (_cached === null) _cached = fetchDiscover();
  return _cached;
}

/** Test-only: clear the memoized promise so successive tests can
 *  return different responses without leaking state. */
export function _resetDiscoverForTests(): void {
  _cached = null;
}
