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

const POST_COLOR = 0x6e7280; // brushed-steel gray; reads as metal once shaded
const BODY_COLOR = 0x14161e; // dark frame / back of the panel
const PANEL_PLACEHOLDER_COLOR = 0x1a1d28;

// Halo proportions — a plane sitting IN FRONT of the panel, with a
// texture that's transparent in the center (so the image reads
// cleanly through the middle) and a heavily-blurred white rectangle
// around it that fades far out into the dark scene. Reads as neon
// light coming OFF the panel forward, with atmospheric falloff —
// not as a back-lit silhouette. PlaneGeometry (not Sprite) so the
// halo orients with the billboard.
const HALO_SCALE = 2.4; // halo plane size as a multiple of panel — wide for soft atmospheric falloff
const HALO_OPACITY = 0.55;
const HALO_COLOR = 0xa8bcff; // cool LED-blue glow tint

/**
 * Total visual height of a billboard as a multiple of its width.
 * Layout uses this to overwrite building.h for media files so the
 * selection outline, camera focus framing, and scene bbox all wrap
 * the full sign instead of the (now-invisible) original building's
 * footprint-sized slab on the ground.
 *
 *   total height = panel height + post height
 *                = (w × PANEL_ASPECT) × (1 + POST_HEIGHT_FRAC)
 */
export const BILLBOARD_HEIGHT_FRAC = PANEL_ASPECT * (1 + POST_HEIGHT_FRAC);

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
  // panel body sitting on top. Standard PBR material with high
  // metalness so the directional light from cityScene gives the
  // cylinders a real "brushed steel" look.
  const postRadius = postW / 2;
  const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, postH, 10);
  const postMat = new THREE.MeshStandardMaterial({
    color: POST_COLOR,
    metalness: 0.85,
    roughness: 0.35,
  });
  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sign * postInset, postH / 2, 0);
    post.userData.kind = 'billboard';
    post.userData.building = building;
    group.add(post);
  }

  // ---- Cyberpunk neon halo, mounted on the panel front ----
  // Additive-blend plane parented to the group so it stays anchored
  // to the panel orientation. Texture is a *ring* gradient (clear
  // center, peak just past panel edge, falloff outward) so the image
  // reads cleanly through the center and the rim glows as a soft
  // bloom into the dark scene. Sized 2× the panel so the bloom has
  // room to fall off without being clipped. Positioned slightly in
  // front of the image plane so the glow renders on the front side
  // where the viewer typically is; DoubleSide keeps it visible from
  // behind too (where the body occludes the center, only the bloom
  // rim shows past the silhouette).
  const haloGeo = new THREE.PlaneGeometry(panelW * HALO_SCALE, panelH * HALO_SCALE);
  const haloMat = new THREE.MeshBasicMaterial({
    // Starts with the generic blurred-rect placeholder + cool blue
    // tint; swapped to an image-derived texture once the panel
    // texture lands (see below) so the bloom matches the actual
    // colors of the sign — the billboard "lights" the air around it.
    map: _haloPlaceholderTexture(),
    color: HALO_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: HALO_OPACITY,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  // Sits a hair in front of the image plane so the glow emits FROM
  // the lit side of the panel (not back-lights from behind). With the
  // image-derived texture's transparent center, the image still reads
  // cleanly; only the surrounding bloom is contributed by the halo.
  halo.position.set(0, postH + panelH / 2, panelD * 0.5 + IMAGE_OFFSET + 0.02);
  // Glow shouldn't intercept clicks — selection should still hit the
  // panel/posts behind/around it.
  halo.raycast = () => {};
  group.add(halo);

  // ---- Place the group at the building's footprint, facing the door. ----
  group.position.set(building.x, 0, building.y);
  group.rotation.y = orientToYRotation(building.orient);

  // ---- Async texture load → swap the image plane's material AND
  // rebuild the halo texture from the panel's own pixels, so the
  // bloom inherits the image's colors. ----
  const filePath = building.file.fullPath || building.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;
  _loadBillboardTexture(url, kind)
    .then((texture) => {
      if (!texture) return;
      image.material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.FrontSide,
      });
      // Replace the placeholder halo with one derived from the image
      // itself — heavy blur of the panel content with the panel-area
      // center cut out. The result: the billboard's actual colors
      // bleed past its edges into the surrounding atmosphere.
      const sourceImg = texture.image as HTMLImageElement | HTMLCanvasElement | null;
      const imageHalo = _imageDerivedHaloTexture(sourceImg);
      if (imageHalo) {
        const prev = haloMat.map;
        haloMat.map = imageHalo;
        // Reset tint to white so the image's own colors come through
        // unaltered (placeholder used HALO_COLOR to give the empty
        // halo a cool tint).
        haloMat.color.set(0xffffff);
        haloMat.needsUpdate = true;
        // Only dispose the prior map if it wasn't the shared placeholder.
        if (prev && prev !== _haloPlaceholderSingleton) prev.dispose();
      }
    })
    .catch(() => {
      /* keep placeholder; building still picks correctly */
    });

  return group;
}

/** Dispose every mesh inside a billboard group — geometry, material,
 * and per-instance texture. The shared halo placeholder texture is
 * NOT disposed here (reused across every billboard); it lives until
 * the page is torn down. Per-instance image-derived halo textures
 * ARE disposed (every billboard gets its own). */
export function disposeBillboard(group: THREE.Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const mat = obj.material as THREE.Material & { map?: THREE.Texture | null };
    if (mat.map && mat.map !== _haloPlaceholderSingleton) mat.map.dispose();
    mat.dispose();
  });
}

// ── Halo textures ────────────────────────────────────────────────────
//
// Placeholder: a single shared blurred-rectangle texture used until
// the panel's actual image lands. Tinted via haloMat.color so it
// reads as a generic cool neon hue.
//
// Per-instance: once the image texture loads, we rebuild the halo
// from the panel's own pixels — heavy blur of the image with the
// panel-area center cut out. The result is a per-billboard bloom
// whose color comes from the sign itself (yellow icons paint yellow
// glow into the air, blue ones blue, etc.), with the transparent
// center letting the actual panel read cleanly through.

let _haloPlaceholderSingleton: THREE.CanvasTexture | null = null;

function _haloPlaceholderTexture(): THREE.CanvasTexture {
  if (_haloPlaceholderSingleton) return _haloPlaceholderSingleton;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    _haloPlaceholderSingleton = new THREE.CanvasTexture(canvas);
    return _haloPlaceholderSingleton;
  }
  // White rect at the panel's texture-space position, blurred outward.
  // No center cutout — the placeholder is a fallback shown only
  // briefly while the real image loads.
  const inset = (size * (1 - 1 / HALO_SCALE)) / 2;
  ctx.save();
  ctx.filter = `blur(${size * 0.18}px)`;
  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.restore();
  _haloPlaceholderSingleton = new THREE.CanvasTexture(canvas);
  _haloPlaceholderSingleton.colorSpace = THREE.SRGBColorSpace;
  return _haloPlaceholderSingleton;
}

/**
 * Build a per-instance halo texture from the panel's own image — the
 * billboard "lights" the surrounding atmosphere with its own colors.
 *
 * 1. Draw the image at panel position within the texture, with a
 *    heavy blur. The blur naturally leaks the image's colors out
 *    past the panel's silhouette into the texture margin.
 * 2. Cut a soft hole in the center matching the panel's footprint
 *    so the front-mounted halo doesn't double-overlay the actual
 *    image (which sits a hair behind the halo).
 *
 * Returns null if the source isn't ready or canvas 2d is unavailable.
 */
function _imageDerivedHaloTexture(
  src: HTMLImageElement | HTMLCanvasElement | null
): THREE.CanvasTexture | null {
  if (!src) return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const inset = (size * (1 - 1 / HALO_SCALE)) / 2;
  const panelW = size - inset * 2;
  const panelH = size - inset * 2;

  // Step 1 — paint the image into the panel rect with heavy blur. The
  // blur spreads the panel's colors outward into the surrounding
  // margin, exactly like a real glowing surface throwing light into
  // the air around it.
  try {
    ctx.save();
    ctx.filter = `blur(${size * 0.18}px)`;
    ctx.drawImage(src, inset, inset, panelW, panelH);
    ctx.restore();
  } catch {
    return null;
  }

  // Step 2 — punch out the center where the actual image plane sits
  // in front of the halo. Soft cutout edge so the boundary between
  // "image" and "image-derived glow" is gradual, not a sharp ring.
  ctx.save();
  ctx.filter = `blur(${size * 0.05}px)`;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  ctx.fillRect(inset, inset, panelW, panelH);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
