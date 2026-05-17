// scene/adPanels.ts — Ad panels mounted on the front face of media-file
// buildings. Replaces the old panel-on-posts billboards: media files
// now render as regular building cuboids (facade, windows, aging) with
// a single textured plane sitting just proud of the front face.
//
// The plane is sized by image aspect ratio so the ad fills the front
// face edge-to-edge without letterboxing. Its bottom edge is anchored
// above the door height; for portrait images on smaller buildings the
// top may extend above the building's roof (Times-Square effect).

import * as THREE from 'three';
import type { Building } from '@/types';
import { BuildingOrient } from '@/types';
import {
  BLOOM,
  AD_PANEL,
  BUILDING_DIMENSIONS,
} from '@/config/index.js';

// Mirrors the media-recognizing extension sets in the Python scanner.
// Kept in sync by hand.
const IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.tiff',
]);
const VIDEO_EXTS: ReadonlySet<string> = new Set([
  '.mp4', '.webm', '.mov', '.ogv', '.m4v', '.mkv',
]);

export type MediaKind = 'image' | 'video';

export function mediaKindOf(file: { extension?: string } | null | undefined): MediaKind | null {
  if (!file) return null;
  const ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function isMediaFile(file: { extension?: string } | null | undefined): boolean {
  return mediaKindOf(file) !== null;
}

// Convert BuildingOrient → Y-axis rotation so the ad plane faces the door.
// Door directions match cameraRig.focusBuilding's contract:
//   South → +Z, North → -Z, East → +X, West → -X.
function orientToYRotation(orient: BuildingOrient): number {
  switch (orient) {
    case BuildingOrient.South: return 0;
    case BuildingOrient.North: return Math.PI;
    case BuildingOrient.East:  return Math.PI / 2;
    case BuildingOrient.West:  return -Math.PI / 2;
    default: return 0;
  }
}

/**
 * Build the ad panel for a media-file building.
 *
 * Width = `building.w × (1 - 2 × AD_SIDE_MARGIN_FRAC)`.
 * Height = `ad_width × aspect` where aspect comes from the file's
 * media_width / media_height (clamped 0.4–2.5; defaults to 1.0 when
 * dims are missing).
 * Vertical anchor: bottom edge sits at `AD_BOTTOM_OFFSET_FLOORS × FLOOR_HEIGHT`
 * above the ground — guarantees the door (0.75 × FLOOR_HEIGHT tall) is
 * never covered. The ad top may exceed the building's roof for tall
 * portrait images on smaller buildings; that's the Times-Square effect.
 *
 * Returns a single Mesh tagged with userData.building so the picker
 * resolves clicks anywhere on the ad to the same file selection a
 * regular building click would produce.
 */
export function createAdPanel(building: Building): THREE.Mesh {
  const kind = mediaKindOf(building.file);
  if (!kind) {
    throw new Error(`createAdPanel: ${building.file?.path} is not a media file`);
  }

  const cfg = AD_PANEL.get();
  const dims = BUILDING_DIMENSIONS.get();
  const bloomCfg = BLOOM.get();
  const adEmission = bloomCfg.ENABLED ? bloomCfg.AD_EMISSION : 1.0;

  // Aspect — re-clamp here because the building.h is floor-snapped and
  // we want the ad to preserve the true image aspect, not the snapped one.
  const mw = building.file.media_width;
  const mh = building.file.media_height;
  const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
  const aspect = Math.min(2.5, Math.max(0.4, rawAspect));

  const adWidth = Math.max(0.1, building.w * (1 - 2 * cfg.AD_SIDE_MARGIN_FRAC));
  const adHeight = adWidth * aspect;
  const bottomY = cfg.AD_BOTTOM_OFFSET_FLOORS * dims.FLOOR_HEIGHT;
  const centerY = bottomY + adHeight / 2;

  const geo = new THREE.PlaneGeometry(adWidth, adHeight);
  const placeholderColor = new THREE.Color(cfg.AD_PLACEHOLDER_COLOR).multiplyScalar(adEmission);
  // polygonOffset pulls the ad mesh's depth toward the camera by a
  // tiny GPU-side bias, eliminating z-fighting with the building wall
  // it's flush against — independent of the 0.02 world-unit AD_OFFSET
  // which alone isn't enough at typical camera distances.
  const mat = new THREE.MeshBasicMaterial({
    color: placeholderColor,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.Mesh(geo, mat);
  // The plane's local +Z is its front normal. We place it on the
  // building's front face at (0, centerY, building.d/2 + AD_OFFSET)
  // in the building's local frame, then rotate the whole thing per
  // building.orient. We achieve this by setting the mesh's world
  // position + rotation directly (no parent group needed — the picker
  // and fader operate on the mesh itself).
  const dHalf = building.d / 2;
  const zOffset = dHalf + cfg.AD_OFFSET;
  // Compute world position by rotating (0, centerY, zOffset) around Y
  // by the orient angle, then translating to (building.x, 0, building.y).
  const angle = orientToYRotation(building.orient);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const worldX = building.x + sin * zOffset;
  const worldZ = building.y + cos * zOffset;
  mesh.position.set(worldX, centerY, worldZ);
  mesh.rotation.y = angle;

  mesh.userData.kind = 'adPanel';
  mesh.userData.role = 'panel';
  mesh.userData.building = building;

  // Async texture load — same texture sources as the old billboards.
  const filePath = building.file.fullPath || building.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;
  _loadAdTexture(url, kind)
    .then((texture) => {
      if (!texture) return;
      const fresh = BLOOM.get();
      const e = fresh.ENABLED ? fresh.AD_EMISSION : 1.0;
      const newMat = new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color(e, e, e),
        side: THREE.FrontSide,
        transparent: true,
        depthWrite: false,
        opacity: (mesh.material as THREE.MeshBasicMaterial).opacity,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      (mesh.material as THREE.Material).dispose();
      mesh.material = newMat;
    })
    .catch(() => { /* keep placeholder; picker still resolves */ });

  return mesh;
}

/** Pulse the current BLOOM.AD_EMISSION value into every ad panel's
 * material color. Called from applyTheme() so the bloom slider affects
 * ads live, without a scene rebuild. */
export function refreshAdPanels(meshes: Iterable<THREE.Mesh>): void {
  const cfg = BLOOM.get();
  const e = cfg.ENABLED ? cfg.AD_EMISSION : 1.0;
  const tint = new THREE.Color(e, e, e);
  const placeholderHex = AD_PANEL.get().AD_PLACEHOLDER_COLOR;
  for (const mesh of meshes) {
    if (mesh.userData.role !== 'panel') continue;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (mat.map) {
      mat.color.copy(tint);
    } else {
      mat.color.copy(new THREE.Color(placeholderHex)).multiply(tint);
    }
  }
}

/** Set the ad panel's opacity. Used by the fader to dial media buildings'
 * ads in/out across the same tiers as regular buildings. The mesh's
 * material was created with transparent:true so this is a no-recompile write. */
export function setAdPanelOpacity(mesh: THREE.Mesh, opacity: number): void {
  const mat = mesh.material as THREE.Material;
  mat.opacity = opacity;
}

/** Dispose the ad mesh's geometry, material, and per-instance texture. */
export function disposeAdPanel(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
  if (mat.map) mat.map.dispose();
  mat.dispose();
}

// ── Texture loading ────────────────────────────────────────────────────

function _loadAdTexture(url: string, kind: MediaKind): Promise<THREE.Texture | null> {
  if (kind === 'image') return _loadImageTexture(url);
  return _loadVideoPosterTexture(url);
}

function _loadImageTexture(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const texture = new THREE.Texture(img);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Render a video's first frame to a canvas, overlay a ▶ play button so
 * the user knows the file is interactive, and use that canvas as the
 * ad texture. The actual playback happens in the right sidebar's
 * <video controls> player — clicking the ad selects the file and that
 * pane swaps in.
 */
function _loadVideoPosterTexture(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    let resolved = false;
    const settle = (texture: THREE.Texture | null) => {
      if (resolved) return;
      resolved = true;
      video.removeAttribute('src');
      video.load();
      resolve(texture);
    };

    const onReady = () => {
      try {
        const canvas = document.createElement('canvas');
        const w = video.videoWidth || 512;
        const h = video.videoHeight || 512;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { settle(null); return; }
        ctx.drawImage(video, 0, 0, w, h);
        _drawPlayOverlay(ctx, w, h);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        settle(texture);
      } catch {
        settle(null);
      }
    };

    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    });
    video.addEventListener('seeked', onReady);
    video.addEventListener('error', () => settle(null));
    setTimeout(() => settle(null), 8000);
  });
}

function _drawPlayOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.18;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const triR = radius * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + triR, cy);
  ctx.lineTo(cx - triR * 0.55, cy - triR * 0.85);
  ctx.lineTo(cx - triR * 0.55, cy + triR * 0.85);
  ctx.closePath();
  ctx.fill();
}
