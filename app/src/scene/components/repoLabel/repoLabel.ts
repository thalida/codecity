// scene/components/repoLabel/repoLabel.ts — Floating holographic
// repo-name label. One group at the scene root, holding a vertical
// light beam from the floor + a Y-locked-billboard text panel.
//
// Lifecycle (matches sky / island):
//   const label = createRepoLabel();
//   scene.add(label.group);              // once, at world boot
//   label.setRepoName(manifest.tree.name);
//   label.setAnchor(gemWorldPos);
//   label.tick(dt, camera);              // every frame
//   label.refresh();                     // on applyTheme() hot-reload
//   label.dispose();                     // on world teardown
//
// Sizing:
//   panel height = REPO_LABEL.FONT_SIZE world units (live-tunable)
//   panel width  = FONT_SIZE × textureAspect (text-content-driven,
//                  so long repo names get proportionally wider panels
//                  rather than squished text)
//   beam length  = REPO_LABEL.HEIGHT world units (spans the gap from
//                  the floor up to the panel's bottom — 0 means the
//                  panel sits flush with the floor and the beam is
//                  invisible)

import * as THREE from 'three';

import { REPO_LABEL } from '@/config/components/repoLabel.js';
import { RENDER_ORDERS } from '@/constants';

import vertSrc from './holoQuad.vert.glsl?raw';
import beamFragSrc from './holoBeam.frag.glsl?raw';
import textFragSrc from './holoText.frag.glsl?raw';
import { createRepoNameTexture, redrawRepoName, type RepoNameTexture } from './textCanvas.js';

// Beam radius as a fraction of FONT_SIZE. Beam thickens automatically
// when the user grows the label — keeps the beam reading as a real
// column of light, not a hairline.
const BEAM_RADIUS_FRAC = 0.04;
// Beam base geometry (radius 1, height 1). mesh.scale.x/z multiplies
// the radius to FONT_SIZE × BEAM_RADIUS_FRAC; mesh.scale.y multiplies
// the height to REPO_LABEL.HEIGHT.
const BEAM_BASE_RADIUS = 1;
const BEAM_BASE_HEIGHT = 1;
// Panel base height (1 unit); the mesh's scale.y multiplies this so its
// world height equals REPO_LABEL.FONT_SIZE. Width is also scaled so
// width = FONT_SIZE × textureAspect.
const PANEL_BASE_HEIGHT = 1;

export interface RepoLabel {
  group: THREE.Group;
  setRepoName(name: string): void;
  setAnchor(anchor: THREE.Vector3): void;
  tick(dtSeconds: number, camera: THREE.Camera): void;
  refresh(): void;
  dispose(): void;
}

// _faceCameraYLocked rotates `obj` so its +Z faces the camera in the XZ
// plane while staying vertical (no tilt).
function _faceCameraYLocked(obj: THREE.Object3D, camera: THREE.Camera): void {
  obj.updateMatrixWorld(true);
  const objPos = new THREE.Vector3();
  obj.getWorldPosition(objPos);
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  const dx = camPos.x - objPos.x;
  const dz = camPos.z - objPos.z;
  obj.rotation.set(0, Math.atan2(dx, dz), 0);
}

export function createRepoLabel(): RepoLabel {
  const group = new THREE.Group();
  group.name = 'repoLabel';

  let textTex: RepoNameTexture | null = null;
  let panelMesh: THREE.Mesh | null = null;
  let beamMesh: THREE.Mesh | null = null;
  let panelMat: THREE.ShaderMaterial | null = null;
  let beamMat: THREE.ShaderMaterial | null = null;

  // Anchor state — the floor-level point the label rises from (the gem's
  // world position). Cached so refresh() can re-apply HEIGHT / FONT_SIZE
  // changes without the caller having to pass the anchor again.
  let anchorX = 0;
  let anchorY = 0;
  let anchorZ = 0;

  function _applyTransform(): void {
    const cfg = REPO_LABEL.get();
    const halfFont = cfg.FONT_SIZE / 2;
    // Group origin = panel center. Panel bottom = HEIGHT above the
    // anchor (floor). So panel center = anchor.y + HEIGHT + halfFont.
    group.position.set(anchorX, anchorY + cfg.HEIGHT + halfFont, anchorZ);
    group.visible = cfg.ENABLED;

    if (beamMesh) {
      // Beam reaches from panel bottom (local y = -halfFont) DOWN
      // to the floor (local y = -halfFont - HEIGHT). Length = HEIGHT.
      // Radius scales with FONT_SIZE so the beam reads proportional
      // to the label it carries.
      const beamRadius = cfg.FONT_SIZE * BEAM_RADIUS_FRAC;
      beamMesh.scale.set(beamRadius, cfg.HEIGHT, beamRadius);
      beamMesh.position.y = -halfFont - cfg.HEIGHT / 2;
    }

    if (panelMesh) {
      // Panel scale.y = FONT_SIZE (panel height in world units).
      // Panel scale.x = FONT_SIZE × textureAspect (so width is text-driven).
      const aspect = textTex?.aspect ?? 1;
      panelMesh.scale.set(cfg.FONT_SIZE * aspect, cfg.FONT_SIZE, 1);
    }
  }

  function _applyOpacity(): void {
    const opacity = REPO_LABEL.get().OPACITY;
    if (panelMat) panelMat.uniforms.uOpacity.value = opacity;
    if (beamMat) beamMat.uniforms.uOpacity.value = opacity;
  }

  // _buildMeshes constructs the panel + beam from the current texture
  // and adds them as children of `group`. Disposes any prior meshes
  // first. Called by setRepoName.
  function _buildMeshes(): void {
    if (!textTex) return;

    // Tear down any existing meshes.
    if (panelMesh) {
      group.remove(panelMesh);
      panelMesh.geometry.dispose();
      panelMat?.dispose();
      panelMesh = null;
      panelMat = null;
    }
    if (beamMesh) {
      group.remove(beamMesh);
      beamMesh.geometry.dispose();
      beamMat?.dispose();
      beamMesh = null;
      beamMat = null;
    }

    // ---- Beam ----
    const beamGeom = new THREE.CylinderGeometry(
      BEAM_BASE_RADIUS,
      BEAM_BASE_RADIUS,
      BEAM_BASE_HEIGHT,
      16,
      1,
      true
    );
    beamMat = new THREE.ShaderMaterial({
      vertexShader: vertSrc,
      fragmentShader: beamFragSrc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 1.0 } },
    });
    beamMesh = new THREE.Mesh(beamGeom, beamMat);
    beamMesh.renderOrder = RENDER_ORDERS.REPO_LABEL;
    group.add(beamMesh);

    // ---- Text panel ----
    // Geometry is a unit plane (1 × 1); scale.x/scale.y in _applyTransform
    // stretches it to FONT_SIZE × (FONT_SIZE × textureAspect) world units.
    const panelGeom = new THREE.PlaneGeometry(1, PANEL_BASE_HEIGHT);
    panelMat = new THREE.ShaderMaterial({
      vertexShader: vertSrc,
      fragmentShader: textFragSrc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uMap: { value: textTex.texture },
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
      },
    });
    panelMesh = new THREE.Mesh(panelGeom, panelMat);
    panelMesh.renderOrder = RENDER_ORDERS.REPO_LABEL;
    group.add(panelMesh);

    _applyOpacity();
    _applyTransform();
  }

  function setRepoName(name: string): void {
    if (!textTex) {
      textTex = createRepoNameTexture(name);
      _buildMeshes();
      return;
    }
    redrawRepoName(textTex, name);
    if (!panelMesh) {
      _buildMeshes();
    } else {
      // Aspect may have changed; re-apply transform so the panel's
      // scale.x updates to the new FONT_SIZE × aspect.
      _applyTransform();
    }
  }

  function setAnchor(anchor: THREE.Vector3): void {
    anchorX = anchor.x;
    anchorY = anchor.y;
    anchorZ = anchor.z;
    _applyTransform();
  }

  function tick(dtSeconds: number, camera: THREE.Camera): void {
    if (!panelMesh || !panelMat) return;
    const cfg = REPO_LABEL.get();
    if (!cfg.ENABLED) return;
    panelMat.uniforms.uTime.value += dtSeconds * cfg.ANIMATION_SPEED;
    _faceCameraYLocked(panelMesh, camera);
  }

  function refresh(): void {
    _applyOpacity();
    _applyTransform();
  }

  function dispose(): void {
    if (panelMesh) {
      group.remove(panelMesh);
      panelMesh.geometry.dispose();
      panelMat?.dispose();
      panelMesh = null;
      panelMat = null;
    }
    if (beamMesh) {
      group.remove(beamMesh);
      beamMesh.geometry.dispose();
      beamMat?.dispose();
      beamMesh = null;
      beamMat = null;
    }
    if (textTex) {
      textTex.texture.dispose();
      textTex = null;
    }
    if (group.parent) group.parent.remove(group);
  }

  return { group, setRepoName, setAnchor, tick, refresh, dispose };
}
