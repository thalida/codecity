<script setup lang="ts">
import "aframe";
import "aframe-orbit-controls";
import "aframe-gradient-sky";
import "aframe-simple-sun-sky";

// import "../environment.js";

import { onMounted, ref } from "vue";
import RenderDirectory from "./RenderDirectory.vue";

const props = defineProps(['repo'])
const cityEl = ref();

const rootRoad = props.repo.render.road;
const orbitCtrlTarget = {
  x: 0,
  y: rootRoad.dimensions.height,
  z: 0,
};
const orbitCtrlTargetStr = `${orbitCtrlTarget.x} ${orbitCtrlTarget.y} ${orbitCtrlTarget.z}`;

const orbitCtrlInitalPos = {
  x: -1 * (props.repo.render.dimensions.width / 2) - 50,
  y: 30,
  z: rootRoad.position.z + 50,
};
const orbitCtrlInitalPosStr = `${orbitCtrlInitalPos.x} ${orbitCtrlInitalPos.y} ${orbitCtrlInitalPos.z}`;

const orbitControls = `target: ${orbitCtrlTargetStr}; initialPosition: ${orbitCtrlInitalPosStr}; minDistance: ${rootRoad.dimensions.height}; maxPolarAngle: 180;`;

const directionalLight = `type: directional; color: #FFF; intensity: 0.6; castShadow: true; shadowBias: -0.001; shadowRadius: 0.1; shadowCameraFar: ${props.repo.render.dimensions.depth}; shadowCameraFov: 90; shadowCameraTop: ${props.repo.render.dimensions.depth}; shadowCameraRight: ${props.repo.render.dimensions.width}; shadowCameraBottom: -${props.repo.render.dimensions.depth}; shadowCameraLeft: -${props.repo.render.dimensions.width}; shadowRadius: 0`;

const directionalLightPos = {
  x: -256,
  y: 512,
  z: -256,
};
const directionalLightPosStr = `${directionalLightPos.x} ${directionalLightPos.y} ${directionalLightPos.z}`;

const floorRadius = (props.repo.render.dimensions.width / 2) + (props.repo.render.dimensions.depth / 2);

const environmentSettings = `preset:forest; playArea: ${floorRadius}`;
onMounted(() => {
  document.querySelector('a-scene').flushToDOM(true);
});
</script>

<template>
  <div ref="cityEl">
    <a-scene shadow="type: pcfsoft">
      <a-simple-sun-sky :sun-position="directionalLightPosStr"></a-simple-sun-sky>
      <a-entity light="type: ambient; color: #BBB"></a-entity>
      <a-entity :light="directionalLight" :position="directionalLightPosStr"></a-entity>
      <a-entity camera look-controls wasd-controls :orbit-controls="orbitControls"></a-entity>
      <a-cone position="0 -150 0" color="green" shadow="cast:false; receive: true" :height="300"
        :radius-top="floorRadius" :radius-bottom="floorRadius / 3" segments-radial="16" material="side: double;">
      </a-cone>

      <!-- <a-entity :environment="environmentSettings"></a-entity> -->
      <!-- <a-entity camera look-controls wasd-controls :orbit-controls="orbitControls"></a-entity> -->


      <RenderDirectory :node="props.repo" />
    </a-scene>
  </div>
</template>
