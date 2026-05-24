// scene/instanced/adPanelTextureArray.ts — Paged DataArrayTexture manager
// for instanced ad panels. Each media file (image or video) gets one
// "flat layer" index in the caller's view; internally that flat index is
// split into (page, localLayer) so we can use multiple smaller
// DataArrayTextures when a repo's media count exceeds the hardware's
// MAX_ARRAY_TEXTURE_LAYERS limit (typical desktop: 2048; spec minimum:
// 256). The fragment shader is given all page textures as a sampler
// array uniform plus a `uPageSize` float, and reconstructs (page,
// localLayer) from the per-instance iLayerIndex value.
//
// Why paged instead of a single bigger texture: a DataArrayTexture's
// depth is bounded by MAX_ARRAY_TEXTURE_LAYERS regardless of how small
// each layer is. Infisical (2.6k media files → adCapacity ≈ 3.9k) is
// past the typical 2048 cap; one DataArrayTexture refused to allocate
// via texStorage3D, leaving every per-layer upload writing into nothing.
// Paging into N <= MAX_PAGES separate texture arrays gives unlimited
// effective depth at the cost of one sampler-array lookup branch per
// fragment.
//
// WebGL2 requirement: sampler2DArray + texture() are GLSL ES 3.00
// features. The ad-panel material must set glslVersion: THREE.GLSL3.
//
// Storage model: each page DataArrayTexture is constructed with
// `data: null` and `source.dataReady = false` so three.js's first-frame
// upload runs only texStorage3D to allocate GPU storage and skips the
// otherwise-broken texSubImage3D(..., null) (which WebGL2 reads as
// `offset=0 into PIXEL_UNPACK_BUFFER` → `INVALID_OPERATION`). Per-layer
// uploads then go straight to the right page's GPU texture via
// renderer.copyTextureToTexture, fed from a tiny per-call scratch canvas
// that's garbage-collected after the copy. There is no CPU-side mirror
// of the texture data.

import * as THREE from 'three';

// Why 128, not 512: ad panels render on small building faces and almost
// never occupy more than a few hundred screen pixels. 128² × 4 = 64 KiB
// per layer keeps GPU memory bounded — at 2048 layers per page that's
// 128 MiB per page, comfortably under any modern integrated GPU's budget.
export const PANEL_TEX_SIZE = 128;

// Maximum number of texture-array pages the fragment shader can dispatch
// into. Must match the size of `uPanelArrays` in adPanel.frag.glsl and
// the number of `else if (page == N)` branches there. At MAX_PAGES = 8
// with a typical pageSize of 2048 layers, this supports 16,384 media
// files per repo — well beyond any realistic codebase. The shader's
// per-fragment branch is on a uniform-ish value (iLayerIndex), so the
// driver usually compiles down to a small jump table; cost is
// negligible at 8 branches.
export const MAX_PAGES = 8;

// Renderer reference for per-layer GPU uploads. Set once by renderLoop.ts
// after the WebGLRenderer is constructed (registerRenderer below). Uploads
// triggered before this point — including any in test environments where
// the renderer never exists — silently no-op so the placeholder color
// stays visible instead of crashing.
let _renderer: THREE.WebGLRenderer | null = null;

export function registerRenderer(renderer: THREE.WebGLRenderer): void {
  _renderer = renderer;
}

// WebGL2 caps texture-array depth at MAX_ARRAY_TEXTURE_LAYERS. We probe
// the actual hardware limit once via a throwaway WebGL2 context and use
// it as the per-page depth. In a non-browser test environment the probe
// falls back to the WebGL2 spec minimum (256).
let _maxArrayLayersCache: number | null = null;
const _MAX_ARRAY_LAYERS_FALLBACK = 256;

function _detectMaxArrayLayers(): number {
  if (_maxArrayLayersCache !== null) return _maxArrayLayersCache;
  if (typeof document === 'undefined') {
    _maxArrayLayersCache = _MAX_ARRAY_LAYERS_FALLBACK;
    return _maxArrayLayersCache;
  }
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl) {
      const limit = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
      _maxArrayLayersCache = typeof limit === 'number' && limit > 0
        ? limit
        : _MAX_ARRAY_LAYERS_FALLBACK;
    } else {
      _maxArrayLayersCache = _MAX_ARRAY_LAYERS_FALLBACK;
    }
  } catch {
    _maxArrayLayersCache = _MAX_ARRAY_LAYERS_FALLBACK;
  }
  return _maxArrayLayersCache;
}

export class AdPanelTextureArray {
  /** One DataArrayTexture per used page; length is in [1, MAX_PAGES].
   *  `shaderTextures` pads this to exactly MAX_PAGES for the shader's
   *  fixed-size sampler array. */
  readonly textures: THREE.DataArrayTexture[];
  /** Layers per page. Reported by the GPU's MAX_ARRAY_TEXTURE_LAYERS and
   *  exposed as a `uPageSize` shader uniform so the shader can decompose
   *  the flat iLayerIndex into (page, localLayer) regardless of which
   *  hardware it runs on. */
  readonly pageSize: number;
  private readonly _capacity: number;
  private _next = 0;

  constructor(capacity = 256) {
    const pageSize = _detectMaxArrayLayers();
    this.pageSize = pageSize;

    const hardCap = MAX_PAGES * pageSize;
    if (capacity > hardCap) {
      // Genuinely past what the shader can address. Bumping MAX_PAGES
      // (and the matching `else if` branches in the shader) is the fix.
      console.warn(
        `[adPanelTextureArray] requested capacity ${capacity} exceeds ` +
        `MAX_PAGES (${MAX_PAGES}) × pageSize (${pageSize}) = ${hardCap}. ` +
        `Bump MAX_PAGES in adPanelTextureArray.ts and add matching shader ` +
        `branches in adPanel.frag.glsl to support more layers.`,
      );
      capacity = hardCap;
    }
    this._capacity = capacity;

    this.textures = [];
    let remaining = capacity;
    while (remaining > 0) {
      const depth = Math.min(remaining, pageSize);
      const tex = new THREE.DataArrayTexture(
        null,
        PANEL_TEX_SIZE,
        PANEL_TEX_SIZE,
        depth,
      );
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // dataReady = false → three.js skips the broken
      // texSubImage3D(..., null) on init and only runs texStorage3D
      // to allocate GPU storage. See the file header for the WebGL
      // error it otherwise produces.
      tex.source.dataReady = false;
      tex.needsUpdate = true;
      this.textures.push(tex);
      remaining -= depth;
    }
  }

  /** Padded MAX_PAGES-long array suitable for binding to the shader's
   *  fixed-size `sampler2DArray uPanelArrays[MAX_PAGES]` uniform. Empty
   *  slots reuse the first page texture — the shader's per-fragment
   *  branch never selects them (iLayerIndex is bounded by capacity), so
   *  the binding is just a "must be valid sampler" formality. */
  get shaderTextures(): THREE.DataArrayTexture[] {
    const padded = this.textures.slice();
    while (padded.length < MAX_PAGES) {
      padded.push(this.textures[0]);
    }
    return padded;
  }

  /** Reserve the next available flat layer index in [0, capacity).
   *  Returns -1 when capacity is exhausted (caller should skip ad-panel
   *  creation for the overflow building). The returned index is what
   *  goes into the per-instance iLayerIndex attribute; the shader maps
   *  it back to (page, localLayer) using uPageSize. */
  allocate(): number {
    if (this._next >= this._capacity) return -1;
    return this._next++;
  }

  /** Blit `img` into the layer at `flatLayer`, scaled to PANEL_TEX_SIZE². */
  async uploadImage(flatLayer: number, img: HTMLImageElement): Promise<void> {
    this._uploadFromCanvas(flatLayer, _scaleToScratch(img));
  }

  /** Blit a canvas (e.g. a video first-frame poster) into the layer at
   *  `flatLayer`. Same semantics as uploadImage but takes a canvas
   *  directly so the video loading path doesn't need a round-trip
   *  through an Image object. */
  async uploadCanvas(flatLayer: number, src: HTMLCanvasElement): Promise<void> {
    this._uploadFromCanvas(flatLayer, _scaleToScratch(src));
  }

  private _uploadFromCanvas(flatLayer: number, canvas: HTMLCanvasElement): void {
    if (!_renderer) return;
    const page = Math.floor(flatLayer / this.pageSize);
    const localLayer = flatLayer - page * this.pageSize;
    const dstTex = this.textures[page];
    if (!dstTex) return;

    const tempTex = new THREE.CanvasTexture(canvas);
    tempTex.format = THREE.RGBAFormat;
    tempTex.type = THREE.UnsignedByteType;
    tempTex.minFilter = THREE.LinearFilter;
    tempTex.magFilter = THREE.LinearFilter;
    // three@0.184 unified API. srcRegion bounds are EXCLUSIVE
    // (width = max.x - min.x), so the full PANEL_TEX_SIZE slice runs from
    // 0 to PANEL_TEX_SIZE on each axis. dstPosition.z selects the
    // destination layer WITHIN this page.
    _renderer.copyTextureToTexture(
      tempTex,
      dstTex,
      new THREE.Box3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(PANEL_TEX_SIZE, PANEL_TEX_SIZE, 1),
      ),
      new THREE.Vector3(0, 0, localLayer),
    );
    tempTex.dispose();
  }

  /** Number of layers allocated so far (across all pages). */
  get count(): number {
    return this._next;
  }

  dispose(): void {
    for (const tex of this.textures) tex.dispose();
  }
}

function _scaleToScratch(src: CanvasImageSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_TEX_SIZE;
  canvas.height = PANEL_TEX_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(src, 0, 0, PANEL_TEX_SIZE, PANEL_TEX_SIZE);
  return canvas;
}
