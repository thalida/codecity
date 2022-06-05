<script setup lang="ts">
import "aframe";
import "aframe-orbit-controls";
import "aframe-gradient-sky";
import "aframe-simple-sun-sky";

import "../environment.js";

import { onMounted } from "vue";
import { TILE_TYPE } from "@/constants/tiles";
import RenderRoad from "./RenderRoad.vue";
import RenderBuilding from "./RenderBuilding.vue";

const props = defineProps(['grid', 'tree'])

const orbitCtrlTarget = {
  x: 0,
  y: 0.5,
  z: 0,
};
const orbitCtrlTargetStr = `${orbitCtrlTarget.x} ${orbitCtrlTarget.y} ${orbitCtrlTarget.z}`;

const orbitCtrlInitalPos = {
  x: 0,
  y: 30,
  z: 0,
};
const orbitCtrlInitalPosStr = `${orbitCtrlInitalPos.x} ${orbitCtrlInitalPos.y} ${orbitCtrlInitalPos.z}`;

const orbitControls = `target: ${orbitCtrlTargetStr}; initialPosition: ${orbitCtrlInitalPosStr}; minDistance: 1; maxPolarAngle: 180;`;

const directionalLight = `type: directional; color: #FFF; intensity: 0.6; castShadow: true; shadowBias: -0.001; shadowRadius: 0.1; shadowCameraFar: 1000; shadowCameraFov: 90; shadowCameraTop: 1000; shadowCameraRight: 1000; shadowCameraBottom: -1000; shadowCameraLeft: -1000; shadowRadius: 0`;

const directionalLightPos = {
  x: -256,
  y: 512,
  z: -256,
};
const directionalLightPosStr = `${directionalLightPos.x} ${directionalLightPos.y} ${directionalLightPos.z}`;

// const floorRadius = (props.repo.render.dimensions.width / 2) + (props.repo.render.dimensions.depth / 2);
const environmentSettings = `preset:forest; playArea: 2000`;
onMounted(() => {
  document.querySelector('a-scene').flushToDOM(true);
});
</script>

<template>
  <div>
    <a-scene shadow="type: pcfsoft">
      <a-simple-sun-sky :sun-position="directionalLightPosStr"></a-simple-sun-sky>
      <a-entity light="type: ambient; color: #BBB"></a-entity>
      <a-entity camera look-controls wasd-controls :orbit-controls="orbitControls"></a-entity>
      <a-entity :light="directionalLight" :position="directionalLightPosStr"></a-entity>

      <!-- <a-cone position="0 -150 0" color="green" shadow="cast:false; receive: true" :height="300" :radius-top="500"
        :radius-bottom="500 / 3" segments-radial="16" material="side: double;">
      </a-cone> -->
      <!--
      <a-entity :environment="environmentSettings"></a-entity>
      <a-entity camera look-controls wasd-controls :orbit-controls="orbitControls"></a-entity> -->


      <!-- <RenderDirectory :node="props.repo" /> -->
      <a-entity v-for="(ys, x) in props.grid">
        <a-entity v-for="(tile, y) in ys" :position="`${x} 0.5 ${y}`">
          <RenderBuilding v-if="tile.type === TILE_TYPE.BUIlDING" :node="props.tree[tile.nodePath]" />
          <RenderRoad v-else :tile="tile" :node="props.tree[tile.nodePath]" />
        </a-entity>
      </a-entity>
    </a-scene>
  </div>
</template>
