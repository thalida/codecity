// scene/billboards.ts — Replace image/video files' building cuboids
// with billboard signs: two support posts holding up a textured panel.
// Image files: panel shows the image. Video files: panel shows the
// first frame with a ▶ overlay so the file reads as interactive — the
// actual playback happens in the right-sidebar's <video controls>.
//
// Each billboard is a THREE.Group containing three meshes (panel +
// two posts). Each mesh carries userData.building so the picker (which
// raycasts against the flat child meshes — see picker.ts) resolves
// clicks anywhere on the structure to the same file selection a
// regular building click would produce.

import * as THREE from 'three';
import type { Building } from '@/types';
import { BuildingOrient } from '@/types';

// Mirrors the media-recognizing extension sets in filePreviewPane.ts —
// kept in sync by hand so the sidebar player and the billboard pick
// the same set of files.
const IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.avif',
  '.tiff',
]);
const VIDEO_EXTS: ReadonlySet<string> = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.ogv',
  '.m4v',
  '.mkv',
]);

export type MediaKind = 'image' | 'video';

/** Returns 'image' / 'video' / null based on the file's extension. */
export function mediaKindOf(file: { extension?: string } | null | undefined): MediaKind | null {
  if (!file) return null;
  const ext = (file.extension || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

/** True iff this file should render as a billboard instead of a regular building. */
export function isMediaFile(file: { extension?: string } | null | undefined): boolean {
  return mediaKindOf(file) !== null;
}

// Proportions tuned to look like a real highway billboard. Width =
// building.w (still byte-derived); the rest scales off that so larger
// files get bigger billboards without losing the recognizable shape.
//
//   ┌────────────────┐         ← PANEL_H  (landscape rect, image lives here)
//   │                │
//   ├──┬──────────┬──┤
//      │          │            ← POST_H   (gap between the two posts)
//      │          │
//      ▔▔▔▔▔▔▔▔▔▔▔▔
//      └POST_W    └POST_W
const PANEL_ASPECT = 0.7; // panel height = panel width × this (landscape)
const PANEL_DEPTH = 0.6;
const POST_HEIGHT_FRAC = 1.1; // post height = panel height × this
const POST_WIDTH_FRAC = 0.06; // post width = panel width × this
const POST_INSET_FRAC = 0.32; // post x-offset from center = panel width × this
const PANEL_BORDER_FRAC = 0.04; // dark frame around the panel as a fraction of panel height

const POST_COLOR = 0x2c2e36; // matches the city's sidewalk gray
const PANEL_BORDER_COLOR = 0x14161e;
const PANEL_PLACEHOLDER_COLOR = 0x1a1d28;

// Convert BuildingOrient → Y-axis rotation so the panel faces the door's direction.
function orientToYRotation(orient: BuildingOrient): number {
  switch (orient) {
    case BuildingOrient.South:
      return 0;
    case BuildingOrient.North:
      return Math.PI;
    case BuildingOrient.East:
      return -Math.PI / 2;
    case BuildingOrient.West:
      return Math.PI / 2;
    default:
      return 0;
  }
}

/**
 * Build a billboard for a media file. Returns immediately with the
 * full structure (panel + posts + dark border) — the real texture
 * loads async (image fetch or video first-frame capture) and swaps
 * the panel material in when it lands.
 */
export function createBillboard(building: Building): THREE.Group {
  const kind = mediaKindOf(building.file);
  if (!kind) {
    throw new Error(`createBillboard: ${building.file?.path} is not a media file`);
  }

  const group = new THREE.Group();
  group.userData.kind = 'billboard';
  group.userData.building = building;

  const panelW = Math.max(1, building.w);
  const panelH = panelW * PANEL_ASPECT;
  const postW = Math.max(0.6, panelW * POST_WIDTH_FRAC);
  const postH = panelH * POST_HEIGHT_FRAC;
  const postInset = panelW * POST_INSET_FRAC;
  const borderT = panelH * PANEL_BORDER_FRAC;

  // ---- Panel (textured) ----
  const panelGeo = new THREE.BoxGeometry(panelW, panelH, PANEL_DEPTH);
  const panelMat = new THREE.MeshBasicMaterial({ color: PANEL_PLACEHOLDER_COLOR });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  // Panel sits above the posts; bottom of panel meets top of post.
  panel.position.set(0, postH + panelH / 2, 0);
  panel.userData.kind = 'billboard';
  panel.userData.building = building;
  group.add(panel);

  // ---- Dark border behind the panel ----
  // A slightly larger box pushed a hair behind the panel so the texture
  // reads as framed. Uses a darker color than the posts so it visually
  // groups with the panel even before the texture loads.
  const borderGeo = new THREE.BoxGeometry(
    panelW + borderT * 2,
    panelH + borderT * 2,
    PANEL_DEPTH * 0.6
  );
  const borderMat = new THREE.MeshBasicMaterial({ color: PANEL_BORDER_COLOR });
  const border = new THREE.Mesh(borderGeo, borderMat);
  border.position.set(0, postH + panelH / 2, -PANEL_DEPTH * 0.21);
  border.userData.kind = 'billboard';
  border.userData.building = building;
  group.add(border);

  // ---- Posts (two vertical pillars) ----
  const postGeo = new THREE.BoxGeometry(postW, postH, postW);
  const postMat = new THREE.MeshBasicMaterial({ color: POST_COLOR });
  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sign * postInset, postH / 2, 0);
    post.userData.kind = 'billboard';
    post.userData.building = building;
    group.add(post);
  }

  // ---- Place the group at the building's footprint, facing the door. ----
  group.position.set(building.x, 0, building.y);
  group.rotation.y = orientToYRotation(building.orient);

  // ---- Async texture load → swap panel material when ready ----
  const filePath = building.file.fullPath || building.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;
  _loadBillboardTexture(url, kind)
    .then((texture) => {
      if (!texture) return;
      panel.material = new THREE.MeshBasicMaterial({ map: texture });
    })
    .catch(() => {
      /* keep placeholder; building still picks correctly */
    });

  return group;
}

/** Dispose every mesh inside a billboard group — geometry, material, and texture. */
export function disposeBillboard(group: THREE.Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const mat = obj.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
  });
}

// ── Texture loading ────────────────────────────────────────────────

function _loadBillboardTexture(url: string, kind: MediaKind): Promise<THREE.Texture | null> {
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
 * billboard texture. The actual playback happens in the right sidebar's
 * <video controls> player — clicking a video billboard selects the
 * file and that pane swaps in.
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
        if (!ctx) {
          settle(null);
          return;
        }
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
      // Seek to ~0.1s — some encoders blank the very first frame.
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    });
    video.addEventListener('seeked', onReady);
    video.addEventListener('error', () => settle(null));
    // Safety timeout in case the video never fires loadeddata/seeked.
    setTimeout(() => settle(null), 8000);
  });
}

/** Translucent dark circle + centered white ▶ triangle. */
function _drawPlayOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.18;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Triangle inset within the circle — point on the right.
  const triR = radius * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + triR, cy);
  ctx.lineTo(cx - triR * 0.55, cy - triR * 0.85);
  ctx.lineTo(cx - triR * 0.55, cy + triR * 0.85);
  ctx.closePath();
  ctx.fill();
}
