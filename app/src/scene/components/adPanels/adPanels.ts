// scene/adPanels.ts — Media-file classification helpers shared by the
// instanced ad-panel renderer (scene/instanced/adPanelsInstanced.ts) and
// the layout module. Recognizes which file extensions get a media-poster
// face rendered on their building.

// Mirrors the media-recognizing extension sets in the Python scanner.
// Kept in sync by hand.
const IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.tiff',
]);
const VIDEO_EXTS: ReadonlySet<string> = new Set([
  '.mp4', '.webm', '.mov', '.ogv', '.m4v', '.mkv',
]);

// String enum so consumers reference MediaKind.Image instead of the
// raw 'image' literal — keeps the values centralized and TS-narrowable.
export enum MediaKind {
  Image = 'image',
  Video = 'video',
}

export function mediaKindOf(file: { extension?: string } | null | undefined): MediaKind | null {
  if (!file) return null;
  const ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return MediaKind.Image;
  if (VIDEO_EXTS.has(ext)) return MediaKind.Video;
  return null;
}

export function isMediaFile(file: { extension?: string } | null | undefined): boolean {
  return mediaKindOf(file) !== null;
}
