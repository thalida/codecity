// city/components/repoLabel/index.ts — Floating holographic
// repo-name label. One group at the scene root, holding a vertical
// light beam from the floor + a camera-facing billboard text panel
// (full 3-axis billboard — pitches with camera elevation, not just yaw).
//
// Self-contained scene component: owns its persistent group, reacts to
// REPO_LABEL settings via an effect (replacing the old refresh() path),
// animates per-frame in tick() (reading REPO_LABEL.ANIMATION_SPEED), and
// frees its own GPU resources + stops its effect in dispose(). Persistent
// — created once at world boot, repositioned per applyManifest.
//
// Lifecycle (matches sky / island / gem):
//   const label = createRepoLabel(ctx);
//   scene.add(label.group);              // once, at world boot
//   label.setRepoName(manifest.tree.name);
//   label.setAnchor(gemWorldPos);
//   label.setGem(_gem.gem);
//   label.tick(dt, frameCtx);           // every frame
//   label.dispose();                    // on world teardown
//
// The settings effect replaces the old refresh() / applyTheme() path:
// it reads REPO_LABEL (ENABLED, HEIGHT_PCT, FONT_SIZE, OPACITY,
// BEAM_COLOR, TEXT_COLOR) and pushes fresh values into uniforms +
// recomputes transform on every REPO_LABEL Save. It runs once at
// construction (idempotently re-applying the same values the constructor
// baked — before setRepoName builds meshes, the opacity/color/transform
// calls are no-ops; subsequent effect runs see the live meshes).
//
// Construction-time bridge (Strategy A, same as sky/island/gem): the
// label is built inside world.ts BEFORE the picker/camera/renderer exist.
// The component accepts the SceneContext for createX(ctx) composer
// uniformity but uses nothing from it; tick() reaches the camera via the
// per-frame FrameContext. The `_ctx` arg is unused (see sky/island
// precedents).
//
// Sizing:
//   panel height = REPO_LABEL.FONT_SIZE world units (applied on Save)
//   panel bottom = REPO_LABEL.HEIGHT_PCT % of max building height above
//                  the anchor (HEIGHT_PCT is the primary positioning key)
//   panel width  = FONT_SIZE × textureAspect (text-content-driven,
//                  so long repo names get proportionally wider panels
//                  rather than squished text)
//   beam length  = (panel bottom world Y) − (gem center world Y).
//                  Beam top sits at the panel bottom; beam bottom
//                  tracks the gem's live position each frame (via
//                  setGem + tick), so the beam follows both the gem's
//                  per-repo hover height AND its bob animation. If no
//                  gem is set, falls back to BEAM_FOOT_FALLBACK above
//                  the anchor.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { REPO_LABEL } from '@/state/stores/settings/gem';
import { RENDER_ORDERS } from '@/city/renderOrders';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import vertSrc from './holoQuad.vert.glsl?raw';
import beamFragSrc from './holoBeam.frag.glsl?raw';
import textFragSrc from './holoText.frag.glsl?raw';
import { createRepoNameTexture, redrawRepoName, type RepoNameTexture } from './textCanvas';

// Beam radius as a fraction of FONT_SIZE. Beam thickens automatically
// when the user grows the label — keeps the beam reading as a real
// column of light, not a hairline.
const BEAM_RADIUS_FRAC = 0.04;
// Beam taper: top radius / bottom radius. Larger = more flare toward
// the panel. 20× — top is a wide bloom roughly matching the panel's
// width band; bottom stays tight at the gem.
const BEAM_TAPER_RATIO = 20.0;
// Beam base geometry — bottom radius 1, top radius = BEAM_TAPER_RATIO.
// mesh.scale.x/z multiplies these so world bottom radius =
// FONT_SIZE × BEAM_RADIUS_FRAC.
const BEAM_BASE_RADIUS_BOTTOM = 1;
const BEAM_BASE_RADIUS_TOP = BEAM_BASE_RADIUS_BOTTOM * BEAM_TAPER_RATIO;
const BEAM_BASE_HEIGHT = 1;
// Fallback beam-foot offset above the anchor, in world units. Used
// when setGem() has not been called (e.g. in tests, or before the
// first manifest applies). When a gem reference is supplied, the
// beam's foot tracks the gem's live world Y instead — so it inherits
// the gem's hover height + bobbing animation.
const BEAM_FOOT_FALLBACK = 10;
// Panel base height (1 unit); the mesh's scale.y multiplies this so its
// world height equals REPO_LABEL.FONT_SIZE. Width is also scaled so
// width = FONT_SIZE × textureAspect.
const PANEL_BASE_HEIGHT = 1;

export interface RepoLabel extends SceneComponent {
  group: THREE.Group;
  setRepoName(name: string): void;
  setAnchor(anchor: THREE.Vector3): void;
  /**
   * Supply a reference to the root gem (its THREE.Group). The beam's
   * bottom will track gem.position.y each frame — picking up both the
   * gem's static hover height (from GEM_SIZING) AND its per-frame bob
   * animation. Pass null to clear (beam falls back to a constant
   * inset above the anchor).
   */
  setGem(gem: THREE.Object3D | null): void;
  tick(dt: number, ctx: FrameContext): void;
  /**
   * World position + size of the floating label panel. Returned in
   * world units so the camera framing code can include the label as
   * a "virtual roof corner" when sizing the start view — essential
   * for empty worlds where there are no buildings to frame against,
   * so the label would otherwise float off-screen.
   *
   * Returns null when the label is disabled or hasn't been positioned
   * yet (no anchor set).
   */
  getPanelBounds(): {
    centerX: number;
    centerY: number;
    centerZ: number;
    halfWidth: number;
    halfHeight: number;
  } | null;
}

// _faceCamera rotates `obj` so its +Z front face points at the camera,
// pitching up/down as the camera's elevation changes (a full billboard,
// not just yaw-locked). Local +Y stays aligned with world up so text
// remains upright regardless of azimuth or tilt.
const _LABEL_WORLD_UP = new THREE.Vector3(0, 1, 0);
const _scratchObjPos = new THREE.Vector3();
const _scratchCamPos = new THREE.Vector3();
const _scratchMat = new THREE.Matrix4();
function _faceCamera(obj: THREE.Object3D, camera: THREE.Camera): void {
  obj.updateMatrixWorld(true);
  obj.getWorldPosition(_scratchObjPos);
  camera.getWorldPosition(_scratchCamPos);
  // Matrix4.lookAt(eye, target, up) builds a basis where local +Z points
  // from target toward eye — i.e. out the panel's front face toward the
  // camera. The world-up arg keeps +Y aligned with world up so text
  // doesn't roll when the camera orbits sideways.
  _scratchMat.lookAt(_scratchCamPos, _scratchObjPos, _LABEL_WORLD_UP);
  obj.quaternion.setFromRotationMatrix(_scratchMat);
}

// `_ctx` is accepted for createX(ctx) composer uniformity; the repoLabel uses
// nothing from it at construction (it reaches the camera via FrameContext
// in tick()). The `_`-prefix matches the eslint argsIgnorePattern.
export function createRepoLabel(_ctx: SceneContext): RepoLabel {
  const group = new THREE.Group();
  group.name = 'repoLabel';

  let textTex: RepoNameTexture | null = null;
  let panelMesh: THREE.Mesh | null = null;
  let beamMesh: THREE.Mesh | null = null;
  let panelMat: THREE.ShaderMaterial | null = null;
  let beamMat: THREE.ShaderMaterial | null = null;

  // Anchor state — the floor-level point the label rises from (the gem's
  // base x/z). Cached so the effect can re-apply HEIGHT_PCT / FONT_SIZE
  // changes without the caller having to pass the anchor again.
  let anchorX = 0;
  let anchorY = 0;
  let anchorZ = 0;

  // Optional gem reference. When set, the beam's bottom tracks the
  // gem's live world Y each frame (so the beam's foot follows the
  // gem's hover height + bob animation).
  let gemRef: THREE.Object3D | null = null;

  // _updateBeamGeometry recomputes the beam's scale + position so its
  // top sits at the panel bottom and its bottom sits at the gem's
  // current world Y (or, if no gem is set, at the fallback inset above
  // the anchor). Called from _applyTransform (for HEIGHT_PCT / FONT_SIZE
  // changes) AND from tick() each frame (so the beam follows the gem's
  // bob animation).
  function _updateBeamGeometry(): void {
    if (!beamMesh) return;
    const cfg = REPO_LABEL.value;
    const halfFont = cfg.FONT_SIZE / 2;
    const beamRadius = cfg.FONT_SIZE * BEAM_RADIUS_FRAC;

    const dims = BUILDING_DIMENSIONS.value;
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
    const cfg = REPO_LABEL.value;
    const halfFont = cfg.FONT_SIZE / 2;
    const dims = BUILDING_DIMENSIONS.value;
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
    const opacity = REPO_LABEL.value.OPACITY;
    if (panelMat) panelMat.uniforms.uOpacity.value = opacity;
    if (beamMat) beamMat.uniforms.uOpacity.value = opacity;
  }

  function _applyColors(): void {
    const cfg = REPO_LABEL.value;
    if (beamMat) (beamMat.uniforms.uColor.value as THREE.Color).set(cfg.BEAM_COLOR);
    if (panelMat) (panelMat.uniforms.uTint.value as THREE.Color).set(cfg.TEXT_COLOR);
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
      uniforms: {
        uColor: { value: new THREE.Color(REPO_LABEL.value.BEAM_COLOR) },
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
      },
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
        uTint: { value: new THREE.Color(REPO_LABEL.value.TEXT_COLOR) },
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
    // redrawRepoName swaps textTex.texture for a fresh CanvasTexture when
    // the canvas width changes (three.js can't resize a GPU allocation
    // after texStorage2D). Repoint the panel uniform so it samples the
    // new texture; without this, the panel keeps reading the disposed
    // one and the new repo name never appears.
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

  // Settings effect — reacts to REPO_LABEL changes (Save). Replaces the
  // old refresh() call in renderLoop.applyTheme(). Reads REPO_LABEL config
  // and pushes fresh opacity, colors, and transform into the live meshes
  // (same writes as the old refresh(), verbatim). Runs once at
  // construction — before setRepoName builds any meshes, so
  // _applyOpacity/_applyColors are no-ops (null guards) and _applyTransform
  // sets the group position/visibility only. Idempotent: subsequent
  // setRepoName / setAnchor calls produce identical or superseding state.
  const stopEffect = effect(() => {
    _applyOpacity();
    _applyColors();
    _applyTransform();
  });

  function tick(dt: number, ctx: FrameContext): void {
    if (!panelMesh || !panelMat) return;
    const cfg = REPO_LABEL.value;
    if (!cfg.ENABLED) return;
    const dtScaled = dt * cfg.ANIMATION_SPEED;
    panelMat.uniforms.uTime.value += dtScaled;
    if (beamMat) beamMat.uniforms.uTime.value += dtScaled;
    _faceCamera(panelMesh, ctx.camera);
    // Track the gem's per-frame bob — the renderLoop mutates
    // gemRef.position.y each frame (sin-wave around its baseY), so the
    // beam's foot follows the gem live.
    _updateBeamGeometry();
  }

  function dispose(): void {
    stopEffect();
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

  function getPanelBounds(): {
    centerX: number;
    centerY: number;
    centerZ: number;
    halfWidth: number;
    halfHeight: number;
  } | null {
    if (!panelMesh || !textTex) return null;
    const cfg = REPO_LABEL.value;
    if (!cfg.ENABLED) return null;
    const halfFont = cfg.FONT_SIZE / 2;
    const dims = BUILDING_DIMENSIONS.value;
    const maxBldgH = dims.MAX_FLOORS * dims.FLOOR_HEIGHT;
    const heightWorld = maxBldgH * (cfg.HEIGHT_PCT / 100);
    // Mirror _applyTransform: panel center sits at anchor.y + heightWorld
    // + halfFont; the group's x/z is the anchor's x/z.
    const centerY = anchorY + heightWorld + halfFont;
    const halfWidth = (cfg.FONT_SIZE * (textTex.aspect ?? 1)) / 2;
    return {
      centerX: anchorX,
      centerY,
      centerZ: anchorZ,
      halfWidth,
      halfHeight: halfFont,
    };
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
