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
// Architecture: a thick dark BODY box gives the sign its mass, an
// IMAGE plane sits flush against the body's front face (single-sided
// so the back stays dark), and a thin inner inset around the image
// reads as a frame.
//
//   ┌──────────────┐ ←─ body (thick box, dark)
//   │ ┌──────────┐ │
//   │ │  image   │ │ ←─ plane mounted on front face, slightly inset
//   │ └──────────┘ │
//   └──┬────────┬──┘
//      │        │   ←─ two support posts
//      ▔▔▔▔▔▔▔▔▔▔
const PANEL_ASPECT = 0.7; // panel height = panel width × this (landscape)
const PANEL_DEPTH_FRAC = 0.08; // body depth = panel width × this (gives the sign real mass)
const PANEL_INSET_FRAC = 0.04; // image inset inside the body (frame thickness)
const IMAGE_OFFSET = 0.02; // image plane sits this far in front of the body face
const POST_HEIGHT_FRAC = 1.1; // post height = panel height × this
const POST_WIDTH_FRAC = 0.06; // post width = panel width × this
const POST_INSET_FRAC = 0.32; // post x-offset from center = panel width × this

const POST_COLOR = 0x2c2e36; // matches the city's sidewalk gray
const BODY_COLOR = 0x14161e; // dark frame / back of the panel
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
  const panelD = panelW * PANEL_DEPTH_FRAC;
  const inset = panelH * PANEL_INSET_FRAC;
  const postW = Math.max(0.6, panelW * POST_WIDTH_FRAC);
  const postH = panelH * POST_HEIGHT_FRAC;
  const postInset = panelW * POST_INSET_FRAC;

  // ---- Panel body — thick dark box, all faces solid ----
  // Gives the sign real 3D mass and acts as the frame around the image;
  // the back of this box is what's visible from behind the billboard.
  const bodyGeo = new THREE.BoxGeometry(panelW, panelH, panelD);
  const bodyMat = new THREE.MeshBasicMaterial({ color: BODY_COLOR });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, postH + panelH / 2, 0);
  body.userData.kind = 'billboard';
  body.userData.building = building;
  group.add(body);

  // ---- Image — single-sided plane mounted on the body's front face ----
  // FrontSide only so a viewer behind the billboard sees the dark back
  // of the body, NOT the image bleeding through. Inset slightly inside
  // the body so the dark body reads as a frame around the image.
  const imageW = panelW - inset * 2;
  const imageH = panelH - inset * 2;
  const imageGeo = new THREE.PlaneGeometry(imageW, imageH);
  const imageMat = new THREE.MeshBasicMaterial({
    color: PANEL_PLACEHOLDER_COLOR,
    side: THREE.FrontSide,
  });
  const image = new THREE.Mesh(imageGeo, imageMat);
  image.position.set(0, postH + panelH / 2, panelD / 2 + IMAGE_OFFSET);
  image.userData.kind = 'billboard';
  image.userData.building = building;
  group.add(image);

  // ---- Posts (two vertical cylinders) ----
  // 10 radial segments → octagon-ish silhouette at the typical zoom
  // levels; cheap to render but reads as round vs the rectangular
  // panel body sitting on top.
  const postRadius = postW / 2;
  const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, postH, 10);
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

  // ---- Async texture load → swap the image plane's material when ready ----
  const filePath = building.file.fullPath || building.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;
  _loadBillboardTexture(url, kind)
    .then((texture) => {
      if (!texture) return;
      image.material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.FrontSide,
      });
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
