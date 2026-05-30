// views/components/badge.ts — Shared builder for the small pill that shows
// "what kind of thing am I looking at": a file extension (color-coded
// from the same hue palette the city uses) or a generic "dir" badge
// (painted with the asphalt color). Used by both the floating header
// and the status-bar footer so the two stay visually in sync with
// the city's current theme — when a user changes the asphalt color
// or a hue in Controls, badges repaint to match.
//
// Text color is auto-contrasted against the badge background using the
// WCAG relative-luminance formula: dark text on bright backgrounds,
// light text on dark backgrounds. That keeps the label readable no
// matter what colors the user picks in Controls.

import { getHue } from '@/scene/components/buildings/buildingColor';

const TEXT_DARK = '#0a0b10';
const TEXT_LIGHT = '#f4f6ff';
// The file badge's CSS rule paints the background with
// `hsl(var(--badge-hue), 60%, 35%)`. We mirror those constants here so
// the JS-side luminance check matches what the user actually sees.
const FILE_BADGE_SATURATION = 0.6;
const FILE_BADGE_LIGHTNESS = 0.35;
// WCAG-derived split point. Tuned a hair below 0.5 so neutral mid-tones
// fall to the light-text side (matches the app's dark theme).
const LUMINANCE_SPLIT = 0.45;

/**
 * Build a `<span class="path-badge">` with the right label and color.
 *
 * For files: text = the extension stripped of its leading dot, capped
 * at 4 chars (or "file" if none). Background hue comes from huePalette
 * so it matches the building color in the city.
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
    chip.style.color = _pickContrastingText(_parseHex(asphaltColor));
    return chip;
  }
  chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
  const hue = getHue(extension ?? '', huePalette);
  chip.style.setProperty('--badge-hue', String(hue));
  chip.style.color = _pickContrastingText(
    _hslToRgb(hue, FILE_BADGE_SATURATION, FILE_BADGE_LIGHTNESS)
  );
  return chip;
}

function _pickContrastingText(rgb: [number, number, number] | null): string {
  if (!rgb) return TEXT_LIGHT;
  return _relativeLuminance(rgb[0], rgb[1], rgb[2]) > LUMINANCE_SPLIT ? TEXT_DARK : TEXT_LIGHT;
}

/**
 * Parse a `#rgb` / `#rrggbb` hex color into [r, g, b] (each 0-255).
 * ASPHALT.COLOR is bound to an `<input type="color">` which always
 * returns the long form, so a 6-digit hex is the realistic input;
 * supporting both forms is a small bit of defensive parsing.
 */
function _parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const raw = hex.replace(/^#/, '');
  const m6 = raw.match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
  const m3 = raw.match(/^([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m3) {
    return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)];
  }
  return null;
}

/** HSL → sRGB. h in [0, 360), s/l in [0, 1]. */
function _hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r: number;
  let g: number;
  let b: number;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** WCAG relative luminance (sRGB → linear → weighted sum). */
function _relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}
