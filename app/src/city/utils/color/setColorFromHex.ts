// city/utils/color/setColorFromHex.ts — Write a CSS hex/style color into a
// THREE.Color WITHOUT Three's automatic sRGB→linear conversion.
//
// setStyle(..., LinearSRGBColorSpace) passes the hex bytes through unchanged.
// The city's authored hex colors are treated as raw display-sRGB bytes: the
// custom fragment shaders run in display sRGB (same convention as
// building.frag.glsl — ShaderMaterial gets no automatic linearToOutputTexel
// pass), and the plain materials that share these palettes (e.g. tree trunks)
// skip the sRGB→linear conversion too so they match that look. Using the
// default (sRGBColorSpace) here would convert, and the colors would no longer
// match their shader-driven neighbors.
//
// Lives next to colors.ts but in its own file: colors.ts is deliberately
// pure color math with no Three.js dependency, and this helper exists
// precisely to talk to a THREE.Color.

import * as THREE from 'three';

export function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}
