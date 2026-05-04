// hsl.js — Pure HSL color helpers. No Three.js, no DOM. Unit-testable in jsdom.

export function hslToComponents(hslString) {
  var inner = hslString.replace(/^hsl\(/i, '').replace(/\)$/, '');
  var parts = inner.split(',');
  return {
    h: parseFloat(parts[0].trim()),
    s: parseFloat(parts[1].trim()),
    l: parseFloat(parts[2].trim())
  };
}

export function componentsToHsl(h, s, l) {
  return 'hsl(' + Math.round(h) + ', ' + s.toFixed(1) + '%, ' + l.toFixed(1) + '%)';
}

export function shadeColor(hslString, amount) {
  var c = hslToComponents(hslString);
  var newL = Math.max(0, Math.min(100, c.l + amount));
  return componentsToHsl(c.h, c.s, newL);
}

export function shadeAndShiftHue(hslString, lightnessDelta, hueDelta, minLightness) {
  var c = hslToComponents(hslString);
  var floor = (minLightness != null) ? minLightness : 0;
  var newL = Math.max(floor, Math.min(100, c.l + lightnessDelta));
  var newH = ((c.h + hueDelta) % 360 + 360) % 360;
  return componentsToHsl(newH, c.s, newL);
}

// Multiplicative darkening with an absolute floor. Used for side walls so that
// contrast against the front face scales with the base lightness — dim files
// still get visibly darker sides without crushing to black.
export function shadeByRatio(hslString, ratio, hueDelta, floor) {
  var c = hslToComponents(hslString);
  var newL = Math.max(floor, c.l * ratio);
  var newH = ((c.h + hueDelta) % 360 + 360) % 360;
  return componentsToHsl(newH, c.s, newL);
}
