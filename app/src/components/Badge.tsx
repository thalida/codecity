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

import { getHue } from '@/city/components/buildings/buildingColor';
import { parseHex, hslToRgb, pickContrastingText } from '@/utils/colors';

// Badge color palette defaults. The file badge's CSS rule paints the background
// with `hsl(var(--badge-hue), 60%, 35%)` — the saturation/lightness defaults
// mirror those values so the JS-side luminance check matches what the user sees.
const DEFAULT_TEXT_DARK = '#0a0b10';
const DEFAULT_TEXT_LIGHT = '#f4f6ff';
const DEFAULT_FILE_BADGE_SATURATION = 0.6;
const DEFAULT_FILE_BADGE_LIGHTNESS = 0.35;

// ── Props interface ─────────────────────────────────────────────────────────

export interface ExtensionBadgeProps {
  extension: string | null | undefined;
  isDir: boolean;
  huePalette: Record<string, number>;
  asphaltColor: string;
  /** Label color used on bright backgrounds. */
  textDark?: string;
  /** Label color used on dark backgrounds. */
  textLight?: string;
  /** Saturation (0–1) for the file badge's hue → RGB luminance check. */
  fileBadgeSaturation?: number;
  /** Lightness (0–1) for the file badge's hue → RGB luminance check. */
  fileBadgeLightness?: number;
}

// ── Preact component ────────────────────────────────────────────────────────

export function ExtensionBadge({
  extension,
  isDir,
  huePalette,
  asphaltColor,
  textDark = DEFAULT_TEXT_DARK,
  textLight = DEFAULT_TEXT_LIGHT,
  fileBadgeSaturation = DEFAULT_FILE_BADGE_SATURATION,
  fileBadgeLightness = DEFAULT_FILE_BADGE_LIGHTNESS,
}: ExtensionBadgeProps) {
  const contrastingText = (rgb: [number, number, number] | null): string =>
    pickContrastingText(rgb, textDark, textLight);

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
  const color = contrastingText(hslToRgb(hue, fileBadgeSaturation, fileBadgeLightness));
  return (
    <span
      class="path-badge"
      style={{ '--badge-hue': String(hue), color } as Record<string, string>}
    >
      {label}
    </span>
  );
}
