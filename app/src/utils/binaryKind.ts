// utils/binaryKind.ts — Binary "data" file classification. Media files are
// binary on the wire too but render as billboards, so they're excluded. THREE-
// free so the layout worker can use it.

import { isMediaFile } from './mediaKind';

type FileLike =
  | { binary?: boolean; mediaKind?: 'image' | 'video' | null; binaryType?: string }
  | null
  | undefined;

/** A binary file that renders as a data building: binary AND not media. Single
 *  source of truth for every data-file surface: sizing, render kind, facade
 *  panels, preview card, icon. */
export function isDataBuilding(file: FileLike): boolean {
  return !!file?.binary && !isMediaFile(file);
}
