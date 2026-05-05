// types/preview.ts — file-preview pane discriminants.

/**
 * What kind of preview a file gets in the right sidebar. Decided by
 * extension; 'text' is the catch-all (rendered with syntax highlighting,
 * or "Binary file" if the bytes don't decode as UTF-8).
 */
export enum PreviewKind {
  Image = 'image',
  Video = 'video',
  Audio = 'audio',
  Pdf = 'pdf',
  Text = 'text',
}
