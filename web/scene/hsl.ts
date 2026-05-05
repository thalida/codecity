// hsl.ts — Pure HSL color helpers. No Three.js, no DOM. Unit-testable in jsdom.

export interface HslComponents {
  h: number;
  s: number;
  l: number;
}

export function hslToComponents(hslString: string): HslComponents {
  const inner = hslString.replace(/^hsl\(/i, '').replace(/\)$/, '');
  const parts = inner.split(',');
  return {
    h: parseFloat(parts[0].trim()),
    s: parseFloat(parts[1].trim()),
    l: parseFloat(parts[2].trim()),
  };
}

export function componentsToHsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

export function shadeColor(hslString: string, amount: number): string {
  const c = hslToComponents(hslString);
  const newL = Math.max(0, Math.min(100, c.l + amount));
  return componentsToHsl(c.h, c.s, newL);
}

export function shadeAndShiftHue(
  hslString: string,
  lightnessDelta: number,
  hueDelta: number,
  minLightness?: number
): string {
  const c = hslToComponents(hslString);
  const floor = minLightness != null ? minLightness : 0;
  const newL = Math.max(floor, Math.min(100, c.l + lightnessDelta));
  const newH = (((c.h + hueDelta) % 360) + 360) % 360;
  return componentsToHsl(newH, c.s, newL);
}

// Multiplicative darkening with an absolute floor. Used for side walls so that
// contrast against the front face scales with the base lightness — dim files
// still get visibly darker sides without crushing to black.
export function shadeByRatio(
  hslString: string,
  ratio: number,
  hueDelta: number,
  floor: number
): string {
  const c = hslToComponents(hslString);
  const newL = Math.max(floor, c.l * ratio);
  const newH = (((c.h + hueDelta) % 360) + 360) % 360;
  return componentsToHsl(newH, c.s, newL);
}
