// components/nodes/KindBadge/KindBadge.tsx — the pill saying what kind of thing you're looking at,
// painted from that thing's own colour in the city so a Controls change repaints
// it too. Its text colour is chosen by luminance against that fill.

import './KindBadge.css';
import { getHue } from '@/city/scene/components/buildings/color';
import {
  parseHex,
  hslToRgb,
  pickContrastingText,
  FILE_TAG_SATURATION,
  FILE_TAG_LIGHTNESS,
} from '@/utils/colors';
import { NodeKind } from '@/types';
import { BUILDINGS } from '@/city/session/settings/buildings';
import { STREETS } from '@/city/session/settings/streets';

// The luminance check reads the same saturation and lightness the CSS paints,
// so it judges the colour actually on screen.
const DEFAULT_TEXT_DARK = '#0a0b10';
const DEFAULT_TEXT_LIGHT = '#f4f6ff';
const DEFAULT_FILE_BADGE_SATURATION = FILE_TAG_SATURATION / 100;
const DEFAULT_FILE_BADGE_LIGHTNESS = FILE_TAG_LIGHTNESS / 100;

// ── Props interface ─────────────────────────────────────────────────────────

export interface KindBadgeProps {
  /** Which of the three selectable things this names. */
  kind: NodeKind;
  /** Files only: drives both the label and the hue. */
  extension?: string | null;
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

export function KindBadge({
  kind,
  extension,
  textDark = DEFAULT_TEXT_DARK,
  textLight = DEFAULT_TEXT_LIGHT,
  fileBadgeSaturation = DEFAULT_FILE_BADGE_SATURATION,
  fileBadgeLightness = DEFAULT_FILE_BADGE_LIGHTNESS,
}: KindBadgeProps) {
  // Read the live theme directly so callers don't have to thread these through —
  // the city's extension→hue palette and the dir badge's asphalt color.
  const huePalette = BUILDINGS.value.HUE_EXT_MAP;
  const asphaltColor = STREETS.value.ASPHALT_COLOR;
  const contrastingText = (rgb: [number, number, number] | null): string =>
    pickContrastingText(rgb, textDark, textLight);

  if (kind === NodeKind.Commit) {
    // A commit's tree is two near-black tones, which paints a chip as a black
    // rectangle; the other kinds borrow a colour that can carry a label.
    return <span class="path-badge is-commit">commit</span>;
  }
  if (kind === NodeKind.Directory) {
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
