// components/Badge.tsx — Shared builder for the small pill that shows
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
