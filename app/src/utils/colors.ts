// utils/colors.ts — Generic color helpers: hex / HSL parsing and WCAG
// luminance. Used by anything that needs to compute readable text colors
// against a dynamic background (e.g. the path badge in the floating
// header). The HSL→RGB and luminance formulas are CSS/WCAG standard
// math; they don't belong inside any single component.

/** The extension "file tag" color: the same hue → HSL the KindBadge paints
 *  (Badge.css: hsl(var(--badge-hue), 60%, 35%)), so hue previews match the badge
 *  users actually see. Saturation/lightness are percentages. */
export const FILE_TAG_SATURATION = 60;
export const FILE_TAG_LIGHTNESS = 35;
export function fileTagHsl(hue: number): string {
  return `hsl(${hue}, ${FILE_TAG_SATURATION}%, ${FILE_TAG_LIGHTNESS}%)`;
}

/** Parse a `#rgb` / `#rrggbb` hex color into [r, g, b] (each 0-255). */
export function parseHex(hex: string): [number, number, number] | null {
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

/**
 * Normalize a hex color to canonical lowercase `#rrggbb` form. Expands the
 * short `#rgb` form. Returns `#000000` for anything unparseable. Pure (no
 * DOM) — the app's colors are always hex, so no CSS-color round-trip probe
 * is needed.
 */
export function normalizeHex(input: unknown): string {
  if (typeof input !== 'string') return '#000000';
  const rgb = parseHex(input);
  if (!rgb) return '#000000';
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** HSL → sRGB. h in [0, 360), s/l in [0, 1]. Returns [r, g, b] each 0-255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
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

/** WCAG relative luminance (sRGB → linear → weighted sum). Returns 0..1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Pick a readable text color (dark or light) for the given background.
 * Returns one of the two text colors based on the background's WCAG
 * relative luminance — dark text on bright backgrounds, light text on
 * dark backgrounds. `null` rgb falls through to the light text (safe
 * default against unknown/parse-failure backgrounds, which tend to be
 * the app's dark theme).
 */
export function pickContrastingText(
  rgb: [number, number, number] | null,
  textDark: string,
  textLight: string,
  luminanceSplit = 0.45
): string {
  if (!rgb) return textLight;
  return relativeLuminance(rgb[0], rgb[1], rgb[2]) > luminanceSplit ? textDark : textLight;
}
