// views/shell/badge.ts — Shared builder for the small pill that shows
// "what kind of thing am I looking at": a file extension (color-coded
// from the same hue palette the city uses) or a generic "dir" badge.
// Used by both the floating header and the status-bar footer so the two
// places stay visually in sync.

import { getHue } from '@/scene/colors.js';

/**
 * Build a `<span class="path-badge">` with the right label and color.
 *
 * For files: text = the extension stripped of its leading dot, capped
 * at 4 chars (or "file" if none). Hue comes from huePalette so it
 * matches the building color in the city.
 *
 * For directories: text = "dir". Neutral gray — same tone family as
 * the street sidewalks in the scene.
 */
export function makeExtensionBadge(
  extension: string | null | undefined,
  isDir: boolean,
  huePalette: Record<string, number>
): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'path-badge';
  if (isDir) {
    chip.classList.add('is-dir');
    chip.textContent = 'dir';
    return chip;
  }
  chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
  chip.style.setProperty('--badge-hue', String(getHue(extension ?? null, huePalette)));
  return chip;
}
