// scene/components/repoLabel/hologram.ts — Style D: holographic
// projection from the gem.
//
// Sub-group with two meshes:
//   beam   — a thin vertical cylinder rising from the gem to the label
//            altitude; alpha gradient cyan→transparent toward the top.
//   panel  — a Y-locked-billboard plane holding the glitchy holo text.
//
// The beam's height tracks the group's local Y offset of the panel.
// Both pieces are added to a child group so the dispatcher can move
// the whole style by translating its parent.

import * as THREE from 'three';

import vertSrc from './holoQuad.vert.glsl?raw';
import beamFragSrc from './holoBeam.frag.glsl?raw';
import textFragSrc from './holoText.frag.glsl?raw';
import type { RepoLabelStyleInstance } from './styleInstance.js';

const BEAM_HEIGHT = 14;      // world units; beam rises from -BEAM_HEIGHT to 0
                              // relative to the style group's local origin.
const BEAM_RADIUS = 0.12;
const PANEL_HEIGHT = 4;       // world units; PlaneGeometry height.

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

export function createHologramStyle(
  texture: THREE.Texture,
  textureAspect: number
): RepoLabelStyleInstance {
  const group = new THREE.Group();
  group.name = 'repoLabel:hologram';

  // ---- Beam ----
  const beamGeom = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 16, 1, true);
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: beamFragSrc,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 1.0 } },
  });
  const beam = new THREE.Mesh(beamGeom, beamMat);
  // Cylinder is built around the origin; shift it so its top is at y=0
  // (the panel sits at the group origin) and its base extends downward.
  beam.position.y = -BEAM_HEIGHT / 2;
  group.add(beam);

  // ---- Text panel ----
  const panelWidth = PANEL_HEIGHT * textureAspect;
  const panelGeom = new THREE.PlaneGeometry(panelWidth, PANEL_HEIGHT);
  const panelMat = new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: textFragSrc,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
    },
  });
  const panel = new THREE.Mesh(panelGeom, panelMat);
  group.add(panel);

  function tick(dtSeconds: number, camera: THREE.Camera, animationSpeed: number): void {
    panelMat.uniforms.uTime.value += dtSeconds * animationSpeed;
    _faceCameraYLocked(panel, camera);
  }

  function setOpacity(opacity: number): void {
    beamMat.uniforms.uOpacity.value = opacity;
    panelMat.uniforms.uOpacity.value = opacity;
  }

  function dispose(): void {
    beamGeom.dispose();
    beamMat.dispose();
    panelGeom.dispose();
    panelMat.dispose();
  }

  return { group, tick, setOpacity, dispose };
}
