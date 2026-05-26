// scene/components/repoLabel/repoLabel.ts — Floating holographic
// repo-name label. One group at the scene root, holding a vertical
// light beam from the gem + a Y-locked-billboard text panel.
//
// Lifecycle (matches sky / island):
//   const label = createRepoLabel();
//   scene.add(label.group);              // once, at world boot
//   label.setRepoName(manifest.tree.name);
//   label.setAnchor(gemWorldPos, cityHeight);
//   label.tick(dt, camera);              // every frame
//   label.refresh();                     // on applyTheme() hot-reload
//   label.dispose();                     // on world teardown
//
// Sizing:
//   panel height = PANEL_HEIGHT world units (constant)
//   panel width  = PANEL_HEIGHT × textureAspect (text-content-driven,
//                  so long repo names get proportionally wider panels
//                  rather than squished text)
//   beam length  = HEIGHT_ABOVE_CITY world units (so the beam always
//                  reaches from the anchor base to the panel center)

import * as THREE from 'three';

import { REPO_LABEL } from '@/config/components/repoLabel.js';
import { RENDER_ORDERS } from '@/constants';

import vertSrc from './holoQuad.vert.glsl?raw';
import beamFragSrc from './holoBeam.frag.glsl?raw';
import textFragSrc from './holoText.frag.glsl?raw';
import { createRepoNameTexture, redrawRepoName, type RepoNameTexture } from './textCanvas.js';

// Panel world height. 20 lands the text big enough to read on typical
// codecity scenes (cities span 100s of world units, default camera frames
// the city). Bump if it's too small.
const PANEL_HEIGHT = 20;
// Beam base radius in world units. Beam thickness scales with the panel
// indirectly (we don't multiply by aspect — it stays a narrow pillar
// regardless of name length).
const BEAM_RADIUS = 0.6;
// Beam base height (1 unit); the mesh's scale.y multiplies this so its
// world height equals the cached beamLength.
const BEAM_BASE_HEIGHT = 1;

export interface RepoLabel {
  group: THREE.Group;
  setRepoName(name: string): void;
  setAnchor(anchor: THREE.Vector3, cityHeight: number): void;
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

  // Anchor state — cached so refresh() can re-apply HEIGHT_ABOVE_CITY
  // changes without the caller having to pass the anchor again.
  let anchorX = 0;
  let anchorZ = 0;
  let anchorBaseY = 0;

  function _applyTransform(): void {
    const cfg = REPO_LABEL.get();
    group.position.set(anchorX, anchorBaseY + cfg.HEIGHT_ABOVE_CITY, anchorZ);
    group.visible = cfg.ENABLED;

    if (beamMesh) {
      // Beam reaches from the panel (group origin) down to the anchor
      // base, a span of HEIGHT_ABOVE_CITY world units.
      beamMesh.scale.y = cfg.HEIGHT_ABOVE_CITY;
      beamMesh.position.y = -cfg.HEIGHT_ABOVE_CITY / 2;
    }
  }

  function _applyOpacity(): void {
    const opacity = REPO_LABEL.get().OPACITY;
    if (panelMat) panelMat.uniforms.uOpacity.value = opacity;
    if (beamMat) beamMat.uniforms.uOpacity.value = opacity;
  }

  // _buildMeshes constructs the panel + beam from the current texture
  // and adds them as children of `group`. Disposes any prior meshes
  // first. Called by setRepoName (which also handles texture changes).
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
      BEAM_RADIUS,
      BEAM_RADIUS,
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
    // Width is canvas aspect × PANEL_HEIGHT — long repo names get
    // proportionally wider panels (no horizontal squish).
    const panelWidth = PANEL_HEIGHT * textTex.aspect;
    const panelGeom = new THREE.PlaneGeometry(panelWidth, PANEL_HEIGHT);
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

    const aspectBefore = textTex.aspect;
    redrawRepoName(textTex, name);
    // The canvas may have changed aspect (different name length → different
    // canvas.width). Rebuild the panel geometry so the new aspect maps
    // correctly. Beam is unaffected; if aspect is unchanged we can skip
    // the rebuild and just rely on the texture-update.
    if (textTex.aspect !== aspectBefore || !panelMesh) {
      _buildMeshes();
    }
  }

  function setAnchor(anchor: THREE.Vector3, cityHeight: number): void {
    anchorX = anchor.x;
    anchorZ = anchor.z;
    anchorBaseY = Math.max(cityHeight, anchor.y);
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
