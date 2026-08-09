// components/LandingBackdrop — the cold-boot landing's "dark swirl" layer: a
// domain-warped gem-palette gradient, a color ramp pushed around by smooth fbm
// noise, which is what gives it that organic curved-ribbon flow (flat CSS
// radial gradients can't — they're concentric circles).
//
// It renders OVER the landing's demo clip, so the ribbons carry alpha rather
// than painting a background: the calm areas are genuinely transparent and the
// city plays through them. Theme-aware (reads the --cc-gem-* tokens), honors
// prefers-reduced-motion (renders one static frame), non-interactive. If WebGL
// is unavailable it renders nothing and the clip shows on its own.

import './LandingBackdrop.css';
import { useEffect, useRef } from 'preact/hooks';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uCol[4];

// Lower = larger, calmer forms; higher = smaller, busier.
const float SCALE = 0.3;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.0 + 11.3; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  // Aspect-correct, centered coords so the flow isn't stretched.
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
  float t = uTime * 0.008;

  // Domain warp (Inigo Quilez): warp the sample point twice, so the color ramp
  // bends into curved organic ribbons instead of concentric bands.
  vec2 q = vec2(fbm(p * SCALE + vec2(0.0, 0.3 * t)), fbm(p * SCALE + vec2(5.2, 1.3) + vec2(0.0, 0.2 * t)));
  vec2 r = vec2(
    fbm(p * SCALE + 2.5 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(p * SCALE + 2.5 * q + vec2(8.3, 2.8) - 0.15 * t)
  );
  float f = fbm(p * SCALE + 2.5 * r);

  // Hue ramp through all four gems. A positional sweep (uv) spreads the colors
  // across the frame so all four are visible at once; the warp (r/q) bends that
  // sweep into organic bands instead of a straight rainbow. Even thirds keep any
  // one gem from dominating (it read purple-heavy before). cyan->purple->magenta->lime.
  float h = clamp(
    0.5 + 0.6 * (uv.x - 0.5) + 0.35 * (uv.y - 0.5) + 1.0 * (r.x - 0.5) + 0.7 * (q.y - 0.5),
    0.0,
    1.0
  );
  vec3 col = uCol[0];
  col = mix(col, uCol[1], smoothstep(0.12, 0.38, h));
  col = mix(col, uCol[2], smoothstep(0.38, 0.62, h));
  col = mix(col, uCol[3], smoothstep(0.62, 0.88, h));

  // Energy mask: vivid along the ridges, pure background elsewhere — the
  // "mostly black + one bright swirl" contrast the flat washes were missing.
  float energy = smoothstep(0.35, 0.95, f + 0.55 * length(q) - 0.15);
  // Keep the central band (where the hero + cards sit) calmer for readability.
  float band = smoothstep(0.06, 0.40, abs(uv.y - 0.5));
  energy *= mix(0.4, 1.0, band);

  // Alpha, not a mix into uBg: the ribbons float over whatever is behind (the
  // landing's demo clip), so the calm areas have to be genuinely transparent
  // rather than painted background-coloured. Premultiplied, which is the
  // WebGL default the canvas composites with.
  float a = clamp(energy, 0.0, 1.0);
  fragColor = vec4(col * a, a);
}
`;

/** Resolve a CSS custom property to a linear [r,g,b] in 0..1. Goes through a
 *  probe element (so var() + any color space resolve) then a 1x1 2D canvas
 *  (which normalizes oklch/color() serialization to plain sRGB bytes). */
function resolveVarToRgb(varName: string): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.color = `var(${varName})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = resolved || '#fff';
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[codecity] landing backdrop shader failed', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

// Backdrop renders at a fraction of viewport pixels — it's a soft gradient, so
// upscaling is invisible and the fbm stays cheap.
const RENDER_SCALE = 0.65;

export function LandingBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false });
    if (!gl) return; // no WebGL (or jsdom) → CSS fallback wash shows through

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[codecity] landing backdrop link failed', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(prog, 'uResolution');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uCol = gl.getUniformLocation(prog, 'uCol');

    const cols = ['--cc-gem-cyan', '--cc-gem-purple', '--cc-gem-magenta', '--cc-gem-lime'].map(
      resolveVarToRgb
    );
    gl.uniform3fv(uCol, new Float32Array(cols.flat()));

    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * RENDER_SCALE));
      const h = Math.max(1, Math.round(canvas.clientHeight * RENDER_SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = (seconds: number) => {
      gl.uniform1f(uTime, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    if (reduce) {
      render(0);
    } else {
      const t0 = performance.now();
      const frame = (now: number) => {
        render((now - t0) / 1000);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} class="landing-backdrop" aria-hidden="true" />;
}
