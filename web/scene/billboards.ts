// scene/billboards.ts — Replace image/video files' building cuboids
// with flat upright "billboard" planes that display the actual media
// content (image, or the first frame of a video). For video files the
// poster gets a ▶ overlay so the user knows clicking opens the
// in-sidebar player.
//
// Pipeline:
//   - isMediaFile(file): classify by extension
//   - createBillboardMesh(building): synchronous mesh placement,
//     async texture upload. Picker uses userData.building (same shape
//     as legacy per-building meshes) so a click resolves to the same
//     file selection a regular building would.

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

// Constants tuning the billboard look. Width comes from the building's
// own (byte-derived) footprint width so larger media files get larger
// signs — same scale signal as building footprints. Height is a portrait
// multiple so the sign reads as a "poster" rather than a wide frame.
const BILLBOARD_DEPTH = 0.5;
const BILLBOARD_ASPECT = 1.5; // height = width × this

const POSTER_RESOLUTION = 512; // canvas size for video posters

/** Convert BuildingOrient → Y-axis rotation so the billboard faces the door's direction. */
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
 * Build a billboard mesh for a media file. Returns immediately with a
 * placeholder material; the real texture loads async (image fetch or
 * video first-frame capture) and swaps in when ready.
 */
export function createBillboardMesh(building: Building): THREE.Mesh {
  const kind = mediaKindOf(building.file);
  if (!kind) {
    throw new Error(`createBillboardMesh: ${building.file?.path} is not a media file`);
  }

  const width = Math.max(1, building.w);
  const height = width * BILLBOARD_ASPECT;
  const geometry = new THREE.BoxGeometry(width, height, BILLBOARD_DEPTH);

  // Placeholder material — neutral dark gray until the texture lands.
  // BasicMaterial because we want the image to read at its native
  // brightness without scene lighting altering it.
  const material = new THREE.MeshBasicMaterial({ color: 0x1a1d28 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(building.x, height / 2, building.y);
  mesh.rotation.y = orientToYRotation(building.orient);

  // Picker contract: legacy per-building mesh hits resolve through
  // userData.building (see picker.ts interpretHit). Tagging here is
  // enough — no other plumbing needed.
  mesh.userData.kind = 'billboard';
  mesh.userData.building = building;

  // Same-origin relative URL — the API server (or vite dev proxy) is
  // co-located with the page. fullPath is the absolute filesystem
  // path the scanner produced; the server validates it against its
  // allowed-roots set.
  const filePath = building.file.fullPath || building.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;
  _loadBillboardTexture(url, kind)
    .then((texture) => {
      if (!texture) return;
      const next = new THREE.MeshBasicMaterial({ map: texture });
      mesh.material = next;
      mesh.material.needsUpdate = true;
    })
    .catch(() => {
      /* leave placeholder; building still picks correctly */
    });

  return mesh;
}

/** Dispose a billboard mesh's geometry + material + texture. */
export function disposeBillboardMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (mat.map) mat.map.dispose();
  mat.dispose();
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
        const w = video.videoWidth || POSTER_RESOLUTION;
        const h = video.videoHeight || POSTER_RESOLUTION;
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
