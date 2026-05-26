// scene/components/repoLabel/repoLabel.ts — Floating repo-name label.
//
// One group at the scene root that hosts whichever style is currently
// selected. The CanvasTexture for the repo name is owned here and
// reused across style swaps, so changing the STYLE key does not churn
// the text texture.
//
// Lifecycle (matches sky / island):
//   const label = createRepoLabel();
//   scene.add(label.group);              // once, at world boot
//   label.setRepoName(manifest.tree.name);
//   label.setAnchor(gemWorldPos, cityHeight, cityRadius);
//   label.tick(dt, camera);              // every frame
//   label.refresh();                     // on applyTheme() hot-reload
//   label.dispose();                     // on world teardown

import * as THREE from 'three';

import { REPO_LABEL, type RepoLabelStyle } from '@/config/components/repoLabel.js';
import { RENDER_ORDERS } from '@/constants';

import { createRepoNameTexture, redrawRepoName, type RepoNameTexture } from './textCanvas.js';
import { createRingStyle } from './ring.js';
import { createHologramStyle } from './hologram.js';
import { createConcentricStyle } from './concentric.js';
import type { RepoLabelDimensions, RepoLabelStyleInstance } from './styleInstance.js';

export interface RepoLabel {
  group: THREE.Group;
  setRepoName(name: string): void;
  setAnchor(anchor: THREE.Vector3, cityHeight: number, cityRadius: number): void;
  tick(dtSeconds: number, camera: THREE.Camera): void;
  refresh(): void;
  dispose(): void;
}

function buildStyle(style: RepoLabelStyle, tex: RepoNameTexture): RepoLabelStyleInstance {
  switch (style) {
    case 'ring':
      return createRingStyle(tex.texture);
    case 'hologram':
      return createHologramStyle(tex.texture, tex.aspect);
    case 'concentric':
      return createConcentricStyle(tex.texture);
  }
}

function applyRenderOrder(styleGroup: THREE.Group): void {
  for (const child of styleGroup.children) {
    child.renderOrder = RENDER_ORDERS.REPO_LABEL;
  }
}

export function createRepoLabel(): RepoLabel {
  const group = new THREE.Group();
  group.name = 'repoLabel';

  let textTex: RepoNameTexture | null = null;
  let currentStyle: RepoLabelStyle | null = null;
  let active: RepoLabelStyleInstance | null = null;

  // Anchor state — kept so refresh() can re-apply HEIGHT_ABOVE_CITY
  // changes without the caller having to pass the anchor again.
  let anchorX = 0;
  let anchorZ = 0;
  let anchorBaseY = 0;
  let currentCityRadius = 0;

  function _currentDimensions(): RepoLabelDimensions {
    return {
      cityRadius: currentCityRadius,
      beamLength: REPO_LABEL.get().HEIGHT_ABOVE_CITY,
    };
  }

  function _swapStyle(target: RepoLabelStyle): void {
    if (!textTex) return;
    if (active) {
      group.remove(active.group);
      active.dispose();
      active = null;
    }
    active = buildStyle(target, textTex);
    active.setDimensions(_currentDimensions());
    applyRenderOrder(active.group);
    group.add(active.group);
    currentStyle = target;
    // Re-apply opacity from store so the new style starts at the right value.
    active.setOpacity(REPO_LABEL.get().OPACITY);
  }

  function _applyTransform(): void {
    const cfg = REPO_LABEL.get();
    group.position.set(anchorX, anchorBaseY + cfg.HEIGHT_ABOVE_CITY, anchorZ);
    group.visible = cfg.ENABLED;
  }

  function setRepoName(name: string): void {
    if (!textTex) {
      textTex = createRepoNameTexture(name);
    } else {
      redrawRepoName(textTex, name);
    }
    const cfg = REPO_LABEL.get();
    if (!active || currentStyle !== cfg.STYLE) {
      _swapStyle(cfg.STYLE);
    } else if (cfg.STYLE === 'hologram') {
      // Hologram's panel geometry was sized for the previous aspect.
      // Rebuild so the new text isn't squished.
      _swapStyle(cfg.STYLE);
    }
    _applyTransform();
  }

  function setAnchor(anchor: THREE.Vector3, cityHeight: number, cityRadius: number): void {
    anchorX = anchor.x;
    anchorZ = anchor.z;
    anchorBaseY = Math.max(cityHeight, anchor.y);
    currentCityRadius = cityRadius;
    _applyTransform();
    active?.setDimensions(_currentDimensions());
  }

  function tick(dtSeconds: number, camera: THREE.Camera): void {
    if (!active) return;
    const cfg = REPO_LABEL.get();
    if (!cfg.ENABLED) return;
    active.tick(dtSeconds, camera, cfg.ANIMATION_SPEED);
  }

  function refresh(): void {
    const cfg = REPO_LABEL.get();
    if (textTex && active && currentStyle !== cfg.STYLE) {
      _swapStyle(cfg.STYLE);
    }
    if (active) {
      active.setOpacity(cfg.OPACITY);
    }
    _applyTransform();
    active?.setDimensions(_currentDimensions());
  }

  function dispose(): void {
    if (active) {
      group.remove(active.group);
      active.dispose();
      active = null;
    }
    if (textTex) {
      textTex.texture.dispose();
      textTex = null;
    }
    if (group.parent) group.parent.remove(group);
  }

  return { group, setRepoName, setAnchor, tick, refresh, dispose };
}
