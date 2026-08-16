// constants/fileExtensions.ts — extension lists by kind, read by the preview
// pane (which viewer) and the data-building facade (which facade). Lowercase and
// dot-prefixed. What KIND a file is, from the manifest, is utils/fileKind.

export const IMAGE_EXTS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.avif',
];
export const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.ogv', '.m4v'];
export const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];
export const PDF_EXTS = ['.pdf'];
export const FONT_EXTS = ['.woff2', '.woff', '.ttf', '.otf'];
