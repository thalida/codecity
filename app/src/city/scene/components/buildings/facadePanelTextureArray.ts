// city/components/buildings/facadePanelTextureArray.ts — paged
// DataArrayTexture manager for the instanced facade panels. Why it pages, how
// it stores, and what races the renderer: FACADE_PANELS.md.

import * as THREE from 'three';

// Small faces, few hundred screen pixels: see FACADE_PANELS.md.
export const PANEL_TEX_SIZE = 128;

// Pages the shader can dispatch into, and the one source of truth for its
// #define: sizing and drift are FACADE_PANELS.md's "Shader page count".
export const MAX_PAGES = 8;

// Set once the renderer exists; uploads that beat it park here.
// FACADE_PANELS.md, "Uploads race the renderer".
let _renderer: THREE.WebGLRenderer | null = null;
const _rendererWaiters: Array<(r: THREE.WebGLRenderer | null) => void> = [];
const _RENDERER_WAIT_TIMEOUT_MS = 5000;

export function registerRenderer(renderer: THREE.WebGLRenderer): void {
  _renderer = renderer;
  if (_rendererWaiters.length > 0) {
    const waiters = _rendererWaiters.splice(0);
    for (const w of waiters) w(renderer);
  }
}

function _whenRendererReady(): Promise<THREE.WebGLRenderer | null> {
  if (_renderer) return Promise.resolve(_renderer);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: THREE.WebGLRenderer | null): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    _rendererWaiters.push(finish);
    setTimeout(() => finish(null), _RENDERER_WAIT_TIMEOUT_MS);
  });
}

// The hardware's MAX_ARRAY_TEXTURE_LAYERS, probed once; the spec minimum
// stands in where there is no browser.
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
      _maxArrayLayersCache =
        typeof limit === 'number' && limit > 0 ? limit : _MAX_ARRAY_LAYERS_FALLBACK;
    } else {
      _maxArrayLayersCache = _MAX_ARRAY_LAYERS_FALLBACK;
    }
  } catch {
    _maxArrayLayersCache = _MAX_ARRAY_LAYERS_FALLBACK;
  }
  return _maxArrayLayersCache;
}

export class FacadePanelTextureArray {
  /** One per used page, in [1, MAX_PAGES]; `shaderTextures` pads it out. */
  readonly textures: THREE.DataArrayTexture[];
  /** Layers per page, and the `uPageSize` uniform the shader decomposes
   *  iLayerIndex with, so the split follows whatever hardware reports. */
  readonly pageSize: number;
  private readonly _capacity: number;
  private _next = 0;
  // Makes in-flight uploads bail rather than write to deleted textures: a
  // skeleton→final sequence disposes this while its loads are still draining.
  private _disposed = false;

  constructor(capacity = 256) {
    const pageSize = _detectMaxArrayLayers();
    this.pageSize = pageSize;

    const hardCap = MAX_PAGES * pageSize;
    if (capacity > hardCap) {
      // Genuinely past what the shader can address. Bumping MAX_PAGES
      // (and the matching `else if` branches in the shader) is the fix.
      console.warn(
        `[facadePanelTextureArray] requested capacity ${capacity} exceeds ` +
          `MAX_PAGES (${MAX_PAGES}) × pageSize (${pageSize}) = ${hardCap}. ` +
          `Bump MAX_PAGES in facadePanelTextureArray.ts and add matching shader ` +
          `branches in facadePanel.frag.glsl to support more layers.`
      );
      capacity = hardCap;
    }
    this._capacity = capacity;

    this.textures = [];
    let remaining = capacity;
    while (remaining > 0) {
      const depth = Math.min(remaining, pageSize);
      const tex = new THREE.DataArrayTexture(null, PANEL_TEX_SIZE, PANEL_TEX_SIZE, depth);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // The 3D upload path forbids UNPACK_FLIP_Y; the UVs assume none anyway.
      tex.flipY = false;
      // Allocate only: skips the texSubImage3D(..., null) WebGL2 rejects.
      tex.source.dataReady = false;
      tex.needsUpdate = true;
      this.textures.push(tex);
      remaining -= depth;
    }
  }

  /** The shader's fixed-size sampler array. Padding reuses page 0, which
   *  iLayerIndex can never select, so it is a valid-binding formality. */
  get shaderTextures(): THREE.DataArrayTexture[] {
    const padded = this.textures.slice();
    while (padded.length < MAX_PAGES) {
      padded.push(this.textures[0]);
    }
    return padded;
  }

  /** The next flat layer, or -1 when capacity is spent and the caller
   *  should skip that building's panels. Becomes its iLayerIndex. */
  allocate(): number {
    if (this._next >= this._capacity) return -1;
    return this._next++;
  }

  /** Blit `img` into `flatLayer`. False means the layer is still unwritten,
   *  so the caller must not advance iTextureFade onto it. */
  async uploadImage(flatLayer: number, img: HTMLImageElement): Promise<boolean> {
    return this._uploadFromCanvas(flatLayer, _scaleToScratch(img));
  }

  /** Blit a canvas (e.g. a video first-frame poster) into the layer at
   *  `flatLayer`. Same semantics + return contract as uploadImage. */
  async uploadCanvas(flatLayer: number, src: HTMLCanvasElement): Promise<boolean> {
    return this._uploadFromCanvas(flatLayer, _scaleToScratch(src));
  }

  private async _uploadFromCanvas(flatLayer: number, canvas: HTMLCanvasElement): Promise<boolean> {
    if (this._disposed) return false;
    const renderer = await _whenRendererReady();
    if (!renderer || this._disposed) return false;
    const page = Math.floor(flatLayer / this.pageSize);
    const localLayer = flatLayer - page * this.pageSize;
    const dstTex = this.textures[page];
    if (!dstTex) return false;

    const tempTex = new THREE.CanvasTexture(canvas);
    tempTex.format = THREE.RGBAFormat;
    tempTex.type = THREE.UnsignedByteType;
    tempTex.minFilter = THREE.LinearFilter;
    tempTex.magFilter = THREE.LinearFilter;
    // The copy applies the SOURCE's unpack flags, and the 3D path forbids
    // both of these: on by default they log on every upload.
    tempTex.flipY = false;
    tempTex.premultiplyAlpha = false;
    // srcRegion bounds are EXCLUSIVE, and dstPosition.z picks the layer
    // within this page.
    renderer.copyTextureToTexture(
      tempTex,
      dstTex,
      new THREE.Box3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(PANEL_TEX_SIZE, PANEL_TEX_SIZE, 1)
      ),
      new THREE.Vector3(0, 0, localLayer)
    );
    tempTex.dispose();
    return true;
  }

  /** Number of layers allocated so far (across all pages). */
  get count(): number {
    return this._next;
  }

  dispose(): void {
    this._disposed = true;
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
