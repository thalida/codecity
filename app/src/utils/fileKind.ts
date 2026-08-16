// utils/fileKind.ts — what KIND of thing a file is, for every surface that asks
// (sizing, render kind, facades, preview, icon). One FileLike for all three
// questions, since a caller asking one usually asks the others. THREE-free, so
// the layout worker can use it.

/** The values ARE the wire literals, mirroring the backend's
 *  Literal["image", "video"] and contract-guarded via the generated FileNode. */
export enum MediaKind {
  Image = 'image',
  Video = 'video',
}

export type FileLike =
  | {
      size?: number | null;
      lines?: number | null;
      binary?: boolean;
      binaryType?: string;
      mediaKind?: MediaKind | 'image' | 'video' | null;
    }
  | null
  | undefined;

/** The backend classifies extensions (api/media.py) and ships the result on the
 *  wire, so this module knows no extensions. */
export function mediaKindOf(file: FileLike): MediaKind | null {
  const k = file?.mediaKind;
  if (k === MediaKind.Image) return MediaKind.Image;
  if (k === MediaKind.Video) return MediaKind.Video;
  return null;
}

export function isMediaFile(file: FileLike): boolean {
  return mediaKindOf(file) !== null;
}

/** Binary AND not media: media is binary on the wire too, but it gets a
 *  billboard rather than a data block. */
export function isDataBuilding(file: FileLike): boolean {
  return !!file?.binary && !isMediaFile(file);
}

/** Nothing in it, so it renders as a flat slab. Binary and media report lines=0
 *  by design, so they qualify only on a true 0-byte size. */
export function isEmptyFile(file: FileLike): boolean {
  if (!file) return false;
  if (file.size === 0) return true;
  return file.lines === 0 && !file.binary && !isMediaFile(file);
}
