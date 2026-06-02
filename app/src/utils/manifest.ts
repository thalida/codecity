// utils/manifest.ts — Pure predicates over the Manifest shape.

import { EMPTY_MANIFEST } from '@/constants/manifest';

/**
 * True when nothing meaningful is loaded — either the value is absent or it
 * is the cold-boot sentinel. The "no project loaded" state is always
 * represented by the shared EMPTY_MANIFEST reference (set when there's no
 * ?src, on a load error, or before the first manifest is applied), so an
 * identity check is exact — no structural guessing. A real loaded project
 * is never === EMPTY_MANIFEST.
 */
export function isEmptyManifest(m: unknown): boolean {
  return m == null || m === EMPTY_MANIFEST;
}
