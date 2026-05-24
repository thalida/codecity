// scene/instanced/adPanelTextureArray.ts — DataArrayTexture manager for
// instanced ad panels. Each media file (image or video) gets one layer in
// the array texture; the InstancedMesh uses a per-instance iLayerIndex
// attribute to sample the correct layer in the fragment shader.
//
// WebGL2 requirement: THREE.DataArrayTexture requires WebGL2 context
// (sampler2DArray is a GLSL ES 3.00 / WebGL2 feature). The ad-panel
// path is therefore WebGL2-only.
//
// Capacity: fixed at construction time. Overflow allocations return -1 and
// are silently ignored (the building shows no ad panel in cell mode rather
// than crashing). For typical repos a capacity of 256 is generous;
// increase via the InstancedAdPanels constructor arg for very large
// media-heavy repositories.

import * as THREE from 'three';

export const PANEL_TEX_SIZE = 512;

export class AdPanelTextureArray {
  readonly texture: THREE.DataArrayTexture;
  private readonly _capacity: number;
  private _next = 0;
  private readonly _data: Uint8Array;

  constructor(capacity = 256) {
    this._capacity = capacity;
    this._data = new Uint8Array(PANEL_TEX_SIZE * PANEL_TEX_SIZE * 4 * capacity);
    this.texture = new THREE.DataArrayTexture(
      this._data,
      PANEL_TEX_SIZE,
      PANEL_TEX_SIZE,
      capacity,
    );
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /**
   * Reserve the next available layer index.
   * Returns -1 when capacity is exhausted (overflow — the caller should
   * skip ad-panel creation for this building rather than crashing).
   */
  allocate(): number {
    if (this._next >= this._capacity) return -1;
    return this._next++;
  }

  /**
   * Blit `img` into the layer at `layerIndex`, scaled to PANEL_TEX_SIZE × PANEL_TEX_SIZE.
   * Sets texture.needsUpdate so Three.js re-uploads the slice on the next
   * render frame. Safe to call before the renderer has ever rendered the
   * texture — needsUpdate is idempotent.
   */
  async uploadImage(layerIndex: number, img: HTMLImageElement): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = PANEL_TEX_SIZE;
    canvas.height = PANEL_TEX_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, PANEL_TEX_SIZE, PANEL_TEX_SIZE);
    const imageData = ctx.getImageData(0, 0, PANEL_TEX_SIZE, PANEL_TEX_SIZE);
    const offset = layerIndex * PANEL_TEX_SIZE * PANEL_TEX_SIZE * 4;
    this._data.set(imageData.data, offset);
    this.texture.needsUpdate = true;
  }

  /**
   * Blit a canvas (e.g. a video first-frame poster) into the given layer.
   * Same semantics as uploadImage but takes a canvas directly so the
   * video loading path doesn't need a round-trip through an Image object.
   */
  async uploadCanvas(layerIndex: number, src: HTMLCanvasElement): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = PANEL_TEX_SIZE;
    canvas.height = PANEL_TEX_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, PANEL_TEX_SIZE, PANEL_TEX_SIZE);
    const imageData = ctx.getImageData(0, 0, PANEL_TEX_SIZE, PANEL_TEX_SIZE);
    const offset = layerIndex * PANEL_TEX_SIZE * PANEL_TEX_SIZE * 4;
    this._data.set(imageData.data, offset);
    this.texture.needsUpdate = true;
  }

  /** Number of allocated layers so far. */
  get count(): number {
    return this._next;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
