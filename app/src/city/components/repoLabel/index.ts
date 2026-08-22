// city/components/repoLabel/index.ts — floating holographic repo-name label:
// a light beam from the gem up to a camera-billboarded text panel. Panel
// height = FONT_SIZE, bottom at HEIGHT_PCT of max building height; width is
// text-driven (FONT_SIZE × textureAspect); the beam foot tracks the live gem.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { RENDER_ORDERS } from '@/city/types/renderOrders';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';
import vertSrc from './holoQuad.vert.glsl?raw';
import beamFragSrc from './holoBeam.frag.glsl?raw';
import textFragSrc from './holoText.frag.glsl?raw';
import { createRepoNameTexture, redrawRepoName, type RepoNameTexture } from './textCanvas';
import { repoLabelBounds, type RepoLabelBounds } from './bounds';

// Fraction of FONT_SIZE, so growing the label thickens the beam with it.
const BEAM_RADIUS_FRAC = 0.04;
// Top/bottom radius ratio: 20× flares the top into a wide bloom roughly
// matching the panel's width band while the bottom stays tight at the gem.
const BEAM_TAPER_RATIO = 20.0;
// Unit base geometry; mesh.scale turns these into world sizes.
const BEAM_BASE_RADIUS_BOTTOM = 1;
const BEAM_BASE_RADIUS_TOP = BEAM_BASE_RADIUS_BOTTOM * BEAM_TAPER_RATIO;
const BEAM_BASE_HEIGHT = 1;
// Beam-foot offset above the anchor (world units) until setGem() supplies a
// live gem for the foot to track.
const BEAM_FOOT_FALLBACK = 10;
// Unit panel height; scale.y turns it into FONT_SIZE world units.
const PANEL_BASE_HEIGHT = 1;

export interface RepoLabel extends SceneComponent {
  group: THREE.Group;
  setRepoName(name: string): void;
  setAnchor(anchor: THREE.Vector3): void;
  /** The beam foot tracks this gem's live Y (hover height + bob) each
   *  frame; null falls back to a constant inset above the anchor. */
  setGem(gem: THREE.Object3D | null): void;
  tick(dt: number, ctx: FrameContext): void;
  /** World position + size of the panel, so camera framing can treat the
   *  label as a virtual roof corner (null when disabled/unpositioned). */
  getPanelBounds(): {
    centerX: number;
    centerY: number;
    centerZ: number;
    halfWidth: number;
    halfHeight: number;
  } | null;
}

// Full 3-axis billboard (pitches with elevation, not just yaw); world-up
// keeps the text upright at any azimuth.
const _LABEL_WORLD_UP = new THREE.Vector3(0, 1, 0);
const _scratchObjPos = new THREE.Vector3();
const _scratchCamPos = new THREE.Vector3();
const _scratchMat = new THREE.Matrix4();
function _faceCamera(obj: THREE.Object3D, camera: THREE.Camera): void {
  obj.updateMatrixWorld(true);
  obj.getWorldPosition(_scratchObjPos);
  camera.getWorldPosition(_scratchCamPos);
  // lookAt(eye, target, up) points local +Z — the panel's front face —
  // toward the camera without rolling the text.
  _scratchMat.lookAt(_scratchCamPos, _scratchObjPos, _LABEL_WORLD_UP);
  obj.quaternion.setFromRotationMatrix(_scratchMat);
}

// Deps for the repoLabel component.
export interface RepoLabelDeps {
  // Live accessor for the root gem's INNER group: null before the gem's
  // first rebuild, re-read every non-reuse apply so the beam foot tracks it.
  getGem: () => THREE.Object3D | null;
}

// Reads only ctx.sceneState + deps.getGem; the camera arrives per-frame via
// FrameContext, never at construction.
export function createRepoLabel(ctx: SceneContext, deps: RepoLabelDeps): RepoLabel {
  const { config } = ctx;
  const { sceneState } = ctx;
  const group = new THREE.Group();
  group.name = 'repoLabel';

  let textTex: RepoNameTexture | null = null;
  // Kept beside the texture so the framing can size the panel before one exists.
  let repoName = '';
  let panelMesh: THREE.Mesh | null = null;
  let beamMesh: THREE.Mesh | null = null;
  let panelMat: THREE.ShaderMaterial | null = null;
  let beamMat: THREE.ShaderMaterial | null = null;

  // Floor-level anchor the label rises from, cached so settings changes can
  // re-apply without the caller re-passing it.
  let anchorX = 0;
  let anchorY = 0;
  let anchorZ = 0;

  // When set, the beam foot follows this gem's live Y each frame.
  let gemRef: THREE.Object3D | null = null;

  // Beam top sits at the panel bottom, beam bottom at the gem's current
  // world Y — recomputed on settings changes AND per frame (gem bob).
  function _updateBeamGeometry(): void {
    if (!beamMesh) return;
    const cfg = config.REPO_LABEL.value;
    const halfFont = cfg.FONT_SIZE / 2;
    const beamRadius = cfg.FONT_SIZE * BEAM_RADIUS_FRAC;

    const dims = config.BUILDING_DIMENSIONS.value;
    const maxBldgH = dims.MAX_FLOORS * dims.FLOOR_HEIGHT;
    const heightWorld = maxBldgH * (cfg.HEIGHT_PCT / 100);

    const groupWorldY = anchorY + heightWorld + halfFont;
    const beamTopWorld = anchorY + heightWorld; // = panel bottom
    const beamBottomWorld = gemRef ? gemRef.position.y : anchorY + BEAM_FOOT_FALLBACK;
    const beamLength = Math.max(0, beamTopWorld - beamBottomWorld);

    beamMesh.scale.set(beamRadius, beamLength, beamRadius);
    // Place beam center at midpoint of top/bottom (in local coords,
    // relative to the group's world Y).
    const beamCenterWorld = (beamTopWorld + beamBottomWorld) / 2;
    beamMesh.position.y = beamCenterWorld - groupWorldY;
  }

  function _applyTransform(): void {
    const cfg = config.REPO_LABEL.value;
    const halfFont = cfg.FONT_SIZE / 2;
    const dims = config.BUILDING_DIMENSIONS.value;
    const maxBldgH = dims.MAX_FLOORS * dims.FLOOR_HEIGHT;
    const heightWorld = maxBldgH * (cfg.HEIGHT_PCT / 100);
    // Group origin = panel center. Panel bottom = heightWorld above the
    // anchor (floor). So panel center = anchor.y + heightWorld + halfFont.
    group.position.set(anchorX, anchorY + heightWorld + halfFont, anchorZ);
    group.visible = cfg.ENABLED;

    if (panelMesh) {
      // Panel scale.y = FONT_SIZE (panel height in world units).
      // Panel scale.x = FONT_SIZE × textureAspect (so width is text-driven).
      const aspect = textTex?.aspect ?? 1;
      panelMesh.scale.set(cfg.FONT_SIZE * aspect, cfg.FONT_SIZE, 1);
    }

    _updateBeamGeometry();
  }

  function _applyOpacity(): void {
    const opacity = config.REPO_LABEL.value.OPACITY;
    if (panelMat) panelMat.uniforms.uOpacity.value = opacity;
    if (beamMat) beamMat.uniforms.uOpacity.value = opacity;
  }

  function _applyColors(): void {
    const cfg = config.REPO_LABEL.value;
    if (beamMat) (beamMat.uniforms.uColor.value as THREE.Color).set(cfg.BEAM_COLOR);
    if (panelMat) (panelMat.uniforms.uTint.value as THREE.Color).set(cfg.TEXT_COLOR);
  }

  // Remove + dispose the panel and beam meshes; used before a rebuild and
  // on dispose().
  function _teardownMeshes(): void {
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
  }

  function _buildMeshes(): void {
    if (!textTex) return;

    // Tear down any existing meshes.
    _teardownMeshes();

    // ---- Beam ----
    const beamGeom = new THREE.CylinderGeometry(
      BEAM_BASE_RADIUS_TOP,
      BEAM_BASE_RADIUS_BOTTOM,
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
      ...NEUTRAL_POLYGON_OFFSET,
      uniforms: {
        uColor: { value: new THREE.Color(config.REPO_LABEL.value.BEAM_COLOR) },
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
      },
    });
    beamMesh = new THREE.Mesh(beamGeom, beamMat);
    beamMesh.renderOrder = RENDER_ORDERS.REPO_LABEL;
    group.add(beamMesh);

    // ---- Text panel: a unit plane _applyTransform stretches to world size.
    const panelGeom = new THREE.PlaneGeometry(1, PANEL_BASE_HEIGHT);
    panelMat = new THREE.ShaderMaterial({
      vertexShader: vertSrc,
      fragmentShader: textFragSrc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      ...NEUTRAL_POLYGON_OFFSET,
      uniforms: {
        uMap: { value: textTex.texture },
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(config.REPO_LABEL.value.TEXT_COLOR) },
        uOpacity: { value: 1.0 },
      },
    });
    panelMesh = new THREE.Mesh(panelGeom, panelMat);
    panelMesh.renderOrder = RENDER_ORDERS.REPO_LABEL;
    group.add(panelMesh);

    _applyOpacity();
    _applyColors();
    _applyTransform();
  }

  function setRepoName(name: string): void {
    repoName = name;
    if (!textTex) {
      textTex = createRepoNameTexture(name);
      _buildMeshes();
      return;
    }
    const prevTexture = textTex.texture;
    redrawRepoName(textTex, name);
    if (!panelMesh) {
      _buildMeshes();
      return;
    }
    // A width change swaps in a fresh CanvasTexture (GPU allocations can't
    // resize); repoint the sampler or the panel reads the disposed one.
    if (panelMat && textTex.texture !== prevTexture) {
      (panelMat.uniforms.uMap as { value: THREE.Texture }).value = textTex.texture;
    }
    // Aspect may have changed; re-apply transform so the panel's
    // scale.x updates to the new FONT_SIZE × aspect.
    _applyTransform();
  }

  function setAnchor(anchor: THREE.Vector3): void {
    anchorX = anchor.x;
    anchorY = anchor.y;
    anchorZ = anchor.z;
    _applyTransform();
  }

  function setGem(gem: THREE.Object3D | null): void {
    gemRef = gem;
    _updateBeamGeometry();
  }

  // Manifest changes every apply (setRepoName re-runs); on a non-reuse apply
  // the gem rebuilt in the same batch, so getGem() is already fresh.
  const stopAnchor = effect(() => {
    const manifest = sceneState.manifest.value;
    const gemWorldPos = sceneState.gemWorldPos.value;
    if (!manifest) return;
    setRepoName(manifest.tree.name);
    setAnchor(gemWorldPos ?? new THREE.Vector3());
    setGem(deps.getGem());
  });

  // REPO_LABEL Save → push opacity/colors/transform into the live meshes.
  // Safe at construction: the null guards make it a visibility-only no-op.
  const stopEffect = effect(() => {
    _applyOpacity();
    _applyColors();
    _applyTransform();
  });

  function tick(dt: number, ctx: FrameContext): void {
    if (!panelMesh || !panelMat) return;
    const cfg = config.REPO_LABEL.value;
    if (!cfg.ENABLED) return;
    const dtScaled = dt * cfg.ANIMATION_SPEED;
    panelMat.uniforms.uTime.value += dtScaled;
    if (beamMat) beamMat.uniforms.uTime.value += dtScaled;
    _faceCamera(panelMesh, ctx.camera);
    // The gem bobs every frame; keep the beam foot glued to it.
    _updateBeamGeometry();
  }

  function dispose(): void {
    stopAnchor();
    stopEffect();
    _teardownMeshes();
    if (textTex) {
      textTex.texture.dispose();
      textTex = null;
    }
    if (group.parent) group.parent.remove(group);
  }

  function getPanelBounds(): RepoLabelBounds | null {
    return repoLabelBounds(
      repoName,
      { x: anchorX, y: anchorY, z: anchorZ },
      config.REPO_LABEL.value,
      config.BUILDING_DIMENSIONS.value
    );
  }

  return {
    group,
    setRepoName,
    setAnchor,
    setGem,
    tick,
    dispose,
    getPanelBounds,
  };
}
