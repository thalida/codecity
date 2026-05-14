// views/shell/badge.ts — Shared builder for the small pill that shows
// "what kind of thing am I looking at": a file extension (color-coded
// from the same hue palette the city uses) or a generic "dir" badge
// (painted with the asphalt color). Used by both the floating header
// and the status-bar footer so the two stay visually in sync with
// the city's current theme — when a user changes the asphalt color
// or a hue in Controls, badges repaint to match.

import { getHue } from '@/scene/colors.js';

/**
 * Build a `<span class="path-badge">` with the right label and color.
 *
 * For files: text = the extension stripped of its leading dot, capped
 * at 4 chars (or "file" if none). Hue comes from huePalette so it
 * matches the building color in the city.
 *
 * For directories: text = "dir". Background is the configured asphalt
 * color so the badge reads as a tiny street — change ASPHALT.COLOR in
 * Controls and the badge follows.
 */
export function makeExtensionBadge(
  extension: string | null | undefined,
  isDir: boolean,
  huePalette: Record<string, number>,
  asphaltColor: string
): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'path-badge';
  if (isDir) {
    chip.classList.add('is-dir');
    chip.textContent = 'dir';
    chip.style.backgroundColor = asphaltColor;
    return chip;
  }
  chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
  chip.style.setProperty('--badge-hue', String(getHue(extension ?? null, huePalette)));
  return chip;
}
