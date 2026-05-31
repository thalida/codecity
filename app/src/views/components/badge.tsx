// views/components/badge.tsx — Shared builder for the small pill that shows
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
import { parseHex, hslToRgb, pickContrastingText } from '@/utils/colors';

// Badge color palette. The file badge's CSS rule paints the background
// with `hsl(var(--badge-hue), 60%, 35%)` — these constants mirror those
// values so the JS-side luminance check matches what the user sees.
const TEXT_DARK = '#0a0b10';
const TEXT_LIGHT = '#f4f6ff';
const FILE_BADGE_SATURATION = 0.6;
const FILE_BADGE_LIGHTNESS = 0.35;

function contrastingText(rgb: [number, number, number] | null): string {
  return pickContrastingText(rgb, TEXT_DARK, TEXT_LIGHT);
}

// ── Props interface ─────────────────────────────────────────────────────────

export interface ExtensionBadgeProps {
  extension: string | null | undefined;
  isDir: boolean;
  huePalette: Record<string, number>;
  asphaltColor: string;
}

// ── Preact component ────────────────────────────────────────────────────────

export function ExtensionBadge({ extension, isDir, huePalette, asphaltColor }: ExtensionBadgeProps) {
  if (isDir) {
    return (
      <span
        class="path-badge is-dir"
        style={{
          backgroundColor: asphaltColor,
          color: contrastingText(parseHex(asphaltColor)),
        }}
      >
        dir
      </span>
    );
  }
  const label = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
  const hue = getHue(extension ?? '', huePalette);
  const color = contrastingText(hslToRgb(hue, FILE_BADGE_SATURATION, FILE_BADGE_LIGHTNESS));
  return (
    <span
      class="path-badge"
      style={{ '--badge-hue': String(hue), color } as Record<string, string>}
    >
      {label}
    </span>
  );
}

// ── Backward-compat factory (Phase 3c/3d will delete this) ─────────────────

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
    chip.style.color = contrastingText(parseHex(asphaltColor));
    return chip;
  }
  chip.textContent = (extension || '').replace(/^\./, '').slice(0, 4) || 'file';
  const hue = getHue(extension ?? '', huePalette);
  chip.style.setProperty('--badge-hue', String(hue));
  chip.style.color = contrastingText(hslToRgb(hue, FILE_BADGE_SATURATION, FILE_BADGE_LIGHTNESS));
  return chip;
}
