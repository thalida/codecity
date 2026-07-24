// city/utils/mediaKind.ts — Media-file classification.
// Recognizes which files get a media-poster face rendered on their
// building. Reads the backend-computed FileNode.mediaKind (the single
// source of truth — the backend classifies extensions in
// api/services/media.py and ships the result on the wire). Shared by the
// layout pass (which runs in the layout WORKER, so this module must stay
// THREE-free) and the instanced ad-panel renderer
// (components/buildings/facadePanels.ts). This module knows no extensions.

// String enum so consumers reference MediaKind.Image instead of the raw
// 'image' literal — keeps the values centralized and TS-narrowable. The
// values ARE the wire literals: they mirror the backend's
// Literal["image", "video"] and are contract-guarded via the generated
// FileNode type (see types/manifest.contract.ts).
export enum MediaKind {
  Image = 'image',
  Video = 'video',
}

type FileLike = { mediaKind?: MediaKind | 'image' | 'video' | null } | null | undefined;

export function mediaKindOf(file: FileLike): MediaKind | null {
  const k = file?.mediaKind;
  if (k === MediaKind.Image) return MediaKind.Image;
  if (k === MediaKind.Video) return MediaKind.Video;
  return null;
}

export function isMediaFile(file: FileLike): boolean {
  return mediaKindOf(file) !== null;
}
