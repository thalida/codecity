// holoBeam.frag.glsl — Vertical light column rising from the gem to
// the label. Alpha is brightest at the gem (vUv.y = 0) and fades out
// toward the panel (vUv.y = 1). A periodic "energy pulse" — a band
// of extra brightness traveling upward — adds rhythm to the column.

varying vec2 vUv;

uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;

void main() {
  // Vertical fade: bright at the gem (v=0), fading toward the panel (v=1).
  // We keep TWO fade curves: a linear one for the pulse modulator (so
  // the pulse stays visible the whole way up) and a pow-3 one for the
  // base alpha (so the beam is a tight bright point at the gem and
  // reads as faint atmosphere near the top).
  float vFadeLinear = 1.0 - vUv.y;
  // Top fade: pow-2 falloff — soft, the top stays visible as a wide
  // atmospheric bloom rather than disappearing.
  float vFade = pow(vFadeLinear, 2.0);
  // Bottom fade: smoothstep ramps brightness IN from the gem over
  // the bottom 30% of the beam, so the brightest band sits well
  // above the gem rather than directly at it.
  float bottomFade = smoothstep(0.0, 0.30, vUv.y);
  vFade *= bottomFade;
  float baseAlpha = vFade * 0.15;

  // Energy pulse: a narrow band of extra brightness that travels
  // upward at ~0.5 units of beam height per second (at ANIMATION_SPEED=1).
  // The pulse position cycles through [0, 1); when it equals vUv.y the
  // local fragment is at the peak of the pulse.
  float pulsePos = fract(uTime * 0.5);
  float pulseDist = abs(vUv.y - pulsePos);
  // Wrap distance so the pulse looks continuous across the seam.
  pulseDist = min(pulseDist, 1.0 - pulseDist);
  // Narrow Gaussian peak. Higher coefficient = thinner band.
  float pulse = exp(-pulseDist * pulseDist * 250.0);
  // Pulse fades along the column too — using a pow-3 curve like the
  // base alpha, so the pulse loses brightness fast as it travels up
  // and is essentially gone by the time it reaches the panel.
  pulse *= pow(vFadeLinear, 3.0);

  float a = (baseAlpha + pulse * 0.15) * uOpacity;

  gl_FragColor = vec4(uColor, a);
}
