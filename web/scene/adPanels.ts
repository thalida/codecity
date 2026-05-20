// scene/adPanels.ts — Media-file classification helpers shared by the
// instanced ad-panel renderer and the layout module.
//
// The per-mesh createAdPanel() path has been retired. Ad panels are now
// rendered as a single InstancedMesh by scene/instanced/adPanelsInstanced.ts;
// this file exists only to host the media-kind helpers that the instanced
// path and the layout module share.

// Mirrors the media-recognizing extension sets in the Python scanner.
// Kept in sync by hand.
const IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.tiff',
]);
const VIDEO_EXTS: ReadonlySet<string> = new Set([
  '.mp4', '.webm', '.mov', '.ogv', '.m4v', '.mkv',
]);

export type MediaKind = 'image' | 'video';

export function mediaKindOf(file: { extension?: string } | null | undefined): MediaKind | null {
  if (!file) return null;
  const ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function isMediaFile(file: { extension?: string } | null | undefined): boolean {
  return mediaKindOf(file) !== null;
}
