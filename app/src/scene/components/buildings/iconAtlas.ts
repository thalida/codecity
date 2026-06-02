// scene/components/buildings/iconAtlas.ts — Build a single texture atlas of Material Icon
// Theme SVGs so each building's roof can render its file icon via the
// shader. The same fileIcons.ts resolver the tree uses is consulted
// here, so a given file shows the SAME icon in the file tree and on
// its building's roof.
//
// Strategy:
//   1. Walk the manifest's flat file list, collect the unique set of
//      icon names (~tens of names for a typical project).
//   2. Fetch each SVG via the CDN, draw it into a slot of an offscreen
//      canvas (16×16 grid of 64-px slots in a 1024×1024 atlas → up to
//      256 unique icons).
//   3. Wrap the canvas in a THREE.CanvasTexture and remember the
//      iconName → [u, v] (top-left of the slot in atlas-UV space)
//      mapping so the buildings layer can populate per-instance UVs.
//
// One-shot; we don't rebuild on live-update for now. If a new file
// type appears mid-session, its building's roof falls back to "no
// icon" until the next reload.

import * as THREE from 'three';
import { NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest, TreeNode } from '@/types';
import { MATERIAL_ICON_URLS } from '@/constants/materialIcons';
import { getFileIconName } from '@/utils/fileIcons';

// Atlas is 2048×2048 with 128-px slots → up to 16×16 = 256 unique
// icons at 4× the per-icon resolution of the old 64-px slots.
// Memory: 2048×2048×4 bytes = 16 MiB texture (one-time, persistent).
const ATLAS_SIZE = 2048;
const SLOT_SIZE = 128;
const SLOTS_PER_SIDE = ATLAS_SIZE / SLOT_SIZE; // 16
const MAX_SLOTS = SLOTS_PER_SIDE * SLOTS_PER_SIDE; // 256
const SLOT_UV = 1 / SLOTS_PER_SIDE;

export interface IconAtlas {
  /** The atlas as a Three.js texture (use as a sampler2D uniform). */
  texture: THREE.CanvasTexture;
  /**
   * Top-left UV of the icon's slot, or null if the name didn't fit /
   * failed to load. The slot extends from this corner by `slotSize`
   * in both axes.
   */
  uvFor(iconName: string): [number, number] | null;
  /** Slot dimension in atlas-UV units (1 / 16 ≈ 0.0625). */
  slotSize: number;
}

/**
 * Build an icon atlas for the manifest's files. Resolves once every
 * unique icon SVG has either drawn into the atlas or failed (failures
 * just leave their slot blank; the building skips the sample).
 */
export async function buildIconAtlas(
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
): Promise<IconAtlas> {
  const iconNames = _collectIconNames(manifest);

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Should be unreachable in any sane browser; degrade gracefully.
    return _emptyAtlas();
  }

  const uvMap = new Map<string, [number, number]>();
  const drawJobs: Promise<void>[] = [];
  for (let i = 0; i < iconNames.length && i < MAX_SLOTS; i++) {
    const name = iconNames[i];
    const col = i % SLOTS_PER_SIDE;
    const row = Math.floor(i / SLOTS_PER_SIDE);
    const px = col * SLOT_SIZE;
    const py = row * SLOT_SIZE;
    // Tentatively assign the UV; we'll clear it if the load fails.
    uvMap.set(name, [col * SLOT_UV, row * SLOT_UV]);
    drawJobs.push(
      _drawIconInto(ctx, name, px, py).catch(() => {
        // Failed fetch → drop the mapping so the building stays uniconned.
        uvMap.delete(name);
      })
    );
  }

  await Promise.all(drawJobs);

  const texture = new THREE.CanvasTexture(canvas);
  // Atlas-UV math here is "canvas-native" (Y goes down from top-left
  // of the texture). flipY=false stops Three's default Y inversion.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // Anisotropy keeps icons crisp at the steep camera angles typical
  // for roof-down views. 16 is the standard maximum on desktop GPUs
  // and a no-op on devices that don't support it.
  texture.anisotropy = 16;
  texture.needsUpdate = true;

  return {
    texture,
    uvFor(name) {
      return uvMap.get(name) ?? null;
    },
    slotSize: SLOT_UV,
  };
}

function _emptyAtlas(): IconAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  return {
    texture,
    uvFor() {
      return null;
    },
    slotSize: SLOT_UV,
  };
}

function _collectIconNames(
  manifest: Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
): string[] {
  const names = new Set<string>();
  if (!manifest) return [];
  const root =
    'tree' in (manifest as { tree?: unknown }) && (manifest as Manifest).tree
      ? (manifest as Manifest).tree
      : (manifest as TreeNode);
  _walk(root, names);
  return [...names];
}

function _walk(node: TreeNode | DirNode, out: Set<string>): void {
  if (!node) return;
  if (node.type === NodeKind.File) {
    out.add(getFileIconName(node as FileNode));
    return;
  }
  const dir = node as DirNode;
  if (Array.isArray(dir.children)) {
    for (let i = 0; i < dir.children.length; i++) _walk(dir.children[i], out);
  }
}

/**
 * Fetch the SVG via the CDN and draw it into the canvas at (x, y) in
 * a SLOT_SIZE × SLOT_SIZE box. Uses an <img> with crossOrigin so the
 * canvas stays untainted; rejects on load failure.
 */
function _drawIconInto(
  ctx: CanvasRenderingContext2D,
  iconName: string,
  x: number,
  y: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        ctx.drawImage(img, x, y, SLOT_SIZE, SLOT_SIZE);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error(`icon load failed: ${iconName}`));
    img.src = MATERIAL_ICON_URLS[iconName];
  });
}
