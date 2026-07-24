// city/utils/binaryKind.ts — Binary "data" file classification.
// Recognizes which files render as "data buildings" (windowless, byte-sized,
// byte-pattern facade) instead of code towers. Reads FileNode.binary + mediaKind
// (both backend-computed, the single source of truth). Media files are binary on
// the wire too but render as billboards, so they are excluded here. Shared by the
// layout pass (runs in the layout WORKER, so this stays THREE-free), the building
// mesh, the preview pane, the almanac, and the file tree.

import { isMediaFile } from './mediaKind';

type FileLike =
  | { binary?: boolean; mediaKind?: 'image' | 'video' | null; binaryType?: string }
  | null
  | undefined;

/** True for a binary file that renders as a data building: binary on the wire
 *  AND not media. Single source of truth — every surface that special-cases
 *  binaries (size, facade, preview, almanac, tree) reads this. */
export function isDataBuilding(file: FileLike): boolean {
  return !!file?.binary && !isMediaFile(file);
}
