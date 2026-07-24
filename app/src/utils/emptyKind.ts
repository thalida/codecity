// utils/emptyKind.ts — Empty-file classification. An empty file has no
// content to stack, so it renders as a flat slab rather than a MIN_FLOORS
// building. THREE-free so the layout worker can use it.

import { isMediaFile } from './mediaKind';

type FileLike =
  | {
      size?: number | null;
      lines?: number | null;
      binary?: boolean;
      mediaKind?: 'image' | 'video' | null;
    }
  | null
  | undefined;

/** A file with nothing in it. 0 bytes is unambiguous; the lines clause covers
 *  Timeline, which replays line counts rather than byte sizes (a text file at 0
 *  lines held 0 bytes at that commit). Binary and media report lines=0 by
 *  design, so they qualify only on a true 0-byte size. */
export function isEmptyFile(file: FileLike): boolean {
  if (!file) return false;
  if (file.size === 0) return true;
  return file.lines === 0 && !file.binary && !isMediaFile(file);
}
