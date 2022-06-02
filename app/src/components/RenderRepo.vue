<script setup lang="ts">
import "aframe";
import "aframe-orbit-controls";
import "aframe-gradient-sky";
import "aframe-simple-sun-sky";

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
// const orbitCtrlTarget = {
//   x: rootRoad.position.x,
//   y: rootRoad.dimensions.height,
//   z: rootRoad.position.z,
// };
const orbitCtrlTargetStr = `${orbitCtrlTarget.x} ${orbitCtrlTarget.y} ${orbitCtrlTarget.z}`;

const orbitCtrlInitalPos = {
  x: -1 * (rootRoad.dimensions.width / 2) - 100,
  y: 53,
  z: rootRoad.position.z + 100,
};
const orbitCtrlInitalPosStr = `${orbitCtrlInitalPos.x} ${orbitCtrlInitalPos.y} ${orbitCtrlInitalPos.z}`;

const orbitControls = `target: ${orbitCtrlTargetStr}; initialPosition: ${orbitCtrlInitalPosStr}; minDistance: ${rootRoad.dimensions.height}; maxPolarAngle: 180;`;

const directionalLight = `type: directional; color: #FFF; intensity: 0.6; castShadow: true; shadowCameraFar: 2500; shadowCameraFov: 360; shadowCameraTop: ${props.repo.render.dimensions.depth}; shadowCameraRight: ${props.repo.render.dimensions.width}; shadowCameraBottom: -${props.repo.render.dimensions.depth}; shadowCameraLeft: -${props.repo.render.dimensions.width}; shadowRadius: 0`;

// const directionalLightPos = {
//   x: -700.000,
//   y: 512,
//   z: 256,
// };
const directionalLightPos = {
  x: -256,
  y: 512,
  z: -256,
};
const directionalLightPosStr = `${directionalLightPos.x} ${directionalLightPos.y} ${directionalLightPos.z}`;

const floorRadius = (props.repo.render.dimensions.width / 2) + (props.repo.render.dimensions.depth / 2);
console.log(floorRadius, Math.max(props.repo.render.dimensions.width, props.repo.render.dimensions.depth), props.repo.render.dimensions)
onMounted(() => {
  document.querySelector('a-scene').flushToDOM(true);
});
</script>

<template>
  <div ref="cityEl">
    <a-scene>
      <a-simple-sun-sky :sun-position="directionalLightPosStr"></a-simple-sun-sky>
      <a-entity light="type: ambient; color: #BBB"></a-entity>
      <a-entity :light="directionalLight" :position="directionalLightPosStr">
      </a-entity>

      <a-entity camera look-controls wasd-controls :orbit-controls="orbitControls"></a-entity>

      <!-- <a-plane position="0 0 0" rotation="-90 0 0" :width="props.repo.render.dimensions.width"
        :height="props.repo.render.dimensions.depth" color="green" shadow="cast:false; receive: true"></a-plane> -->
      <!-- <a-box position="0 -3 0" color="green" shadow="cast:false; receive: true" :height="6"
        :width="props.repo.render.dimensions.width" :depth="props.repo.render.dimensions.depth"></a-box> -->
      <!-- <a-box position="0 -3 0" color="green" shadow="cast:false; receive: true" :height="6"
        :width="props.repo.render.dimensions.width" :depth="props.repo.render.dimensions.depth"></a-box> -->

      <a-cone position="0 -150 0" color="green" shadow="cast:false; receive: true" :height="300"
        :radius-top="floorRadius" :radius-bottom="floorRadius / 3" segments-radial="16">
      </a-cone>

      <RenderDirectory :node="props.repo" />
    </a-scene>
  </div>
</template>
