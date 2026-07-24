// city/utils/binaryKind.ts — Binary "data" file classification. Media files are
// binary on the wire too but render as billboards, so they're excluded. THREE-
// free so the layout worker can use it.

import { isMediaFile } from './mediaKind';

type FileLike =
  | { binary?: boolean; mediaKind?: 'image' | 'video' | null; binaryType?: string }
  | null
  | undefined;

/** A binary file that renders as a data building: binary AND not media. Single
 *  source of truth for every binary-special-casing surface (size, facade,
 *  preview, almanac, tree). */
export function isDataBuilding(file: FileLike): boolean {
  return !!file?.binary && !isMediaFile(file);
}
