<script setup lang="ts">
import "aframe";
import "aframe-orbit-controls";
import { onMounted, ref } from "vue";
import RenderNode from "./RenderNode.vue";

const props = defineProps(['city'])
const cityEl = ref();

const rootRoad = props.city.neighborhood.nodes[0].render.road;
const cameraPosition = {
  x: -1 * (rootRoad.dimensions.width / 2) - 30,
  // y: rootRoad.dimensions.height,
  y: 30,
  z: rootRoad.position.z + 30,
};
const cameraPositionStr = `${cameraPosition.x} ${cameraPosition.y} ${cameraPosition.z}`;

const cameraRotation = {
  // x: -30,
  x: -90,
  y: 0,
  z: 0,
};
const cameraRotationStr = `${cameraRotation.x} ${cameraRotation.y} ${cameraRotation.z}`;

// const orbitControlsTarget = {
//   x: -1 * (rootRoad.dimensions.width / 2),
//   y: 30,
//   z: rootRoad.position.z,
// };
const orbitControlsTarget = {
  x: 0,
  y: rootRoad.dimensions.height,
  z: 0,
};
const orbitControlsTargetStr = `${orbitControlsTarget.x} ${orbitControlsTarget.y} ${orbitControlsTarget.z}`;
const orbitControls = `target: ${orbitControlsTargetStr}; minDistance: ${rootRoad.dimensions.height}; initialPosition: ${cameraPositionStr}`;

onMounted(() => {
  document.querySelector('a-scene').flushToDOM(true);
});
</script>

<template>
  <div ref="cityEl">
    <a-scene>
      <!-- <a-entity id="rig" :position="cameraPositionStr" :rotation="cameraRotationStr">
        <a-entity id="camera" camera wasd-controls look-controls fov="8.2"></a-entity>
      </a-entity> -->
      <!-- <a-entity id="camera" camera :position="cameraPositionStr" :rotation="cameraRotationStr" wasd-controls
        look-controls></a-entity> -->

      <a-entity camera look-controls wasd-controls :orbit-controls="orbitControls">
      </a-entity>
      <a-sky color="#0000ff"></a-sky>
      <a-plane rotation="-90 0 0" width="30" height="30" color="#ff0048"></a-plane>
      <RenderNode :node="props.city" />
    </a-scene>
  </div>
</template>
