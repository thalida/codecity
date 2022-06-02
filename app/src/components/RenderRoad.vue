<script setup lang="ts">
import "aframe";
import "aframe-gradient-sky";

const props = defineProps(['road'])
const roadPosition = `${props.road.position.x} ${props.road.position.y} ${props.road.position.z}`
const roadDimensions = props.road.dimensions;

function getIntersectionPosition(intersection) {
  return `${intersection.render.position.x} ${intersection.render.position.y} ${intersection.render.position.z}`
}
</script>

<template>
  <a-entity :position="roadPosition" shadow="cast:false; receive: true">
    <a-box color="gray" :width="roadDimensions.width" :height="roadDimensions.height" :depth="roadDimensions.depth">
    </a-box>
    <a-entity v-for="(intersection, idx) in road.intersections" :key="idx">
      <a-box color="yellow" :height="intersection.render.dimensions.height"
        :width="intersection.render.dimensions.width" :depth="intersection.render.dimensions.depth"
        :position="getIntersectionPosition(intersection)">
      </a-box>
    </a-entity>
  </a-entity>
</template>
