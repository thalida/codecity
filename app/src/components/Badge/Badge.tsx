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

import './Badge.css';
import { getHue } from '@/city/components/buildings/color';
import {
  parseHex,
  hslToRgb,
  pickContrastingText,
  FILE_TAG_SATURATION,
  FILE_TAG_LIGHTNESS,
} from '@/utils/colors';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { STREETS } from '@/state/stores/settings/streets';

// Badge color defaults. The file badge's CSS paints hsl(var(--badge-hue), …)
// with the shared file-tag saturation/lightness; the JS-side luminance check
// uses the same values (as 0-1 fractions) so it matches what the user sees.
const DEFAULT_TEXT_DARK = '#0a0b10';
const DEFAULT_TEXT_LIGHT = '#f4f6ff';
const DEFAULT_FILE_BADGE_SATURATION = FILE_TAG_SATURATION / 100;
const DEFAULT_FILE_BADGE_LIGHTNESS = FILE_TAG_LIGHTNESS / 100;

// ── Props interface ─────────────────────────────────────────────────────────

export interface ExtensionBadgeProps {
  extension: string | null | undefined;
  isDir: boolean;
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
  textDark = DEFAULT_TEXT_DARK,
  textLight = DEFAULT_TEXT_LIGHT,
  fileBadgeSaturation = DEFAULT_FILE_BADGE_SATURATION,
  fileBadgeLightness = DEFAULT_FILE_BADGE_LIGHTNESS,
}: ExtensionBadgeProps) {
  // Read the live theme directly so callers don't have to thread these through —
  // the city's extension→hue palette and the dir badge's asphalt color.
  const huePalette = BUILDINGS.value.HUE_EXT_MAP;
  const asphaltColor = STREETS.value.ASPHALT_COLOR;
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
