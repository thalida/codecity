<script setup lang="ts">
import "aframe";
import "aframe-gradient-sky";

const props = defineProps(['node'])
const nodePosition = `${props.node.render.position.x} ${props.node.render.position.y} ${props.node.render.position.z}`
const nodeRotation = `${props.node.render.rotation.x} ${props.node.render.rotation.y} ${props.node.render.rotation.z}`

const propertyDimensions = props.node.render.property.dimensions;
const propertyPosition = `${props.node.render.property.position.x} ${props.node.render.property.position.y} ${props.node.render.property.position.z}`;
</script>

<template>
  <a-entity :position="nodePosition" :rotation="nodeRotation" shadow="cast:true; receive: true;">
    <a-box color="red" :position="propertyPosition" :width="propertyDimensions.width"
      :height="propertyDimensions.height" :depth="propertyDimensions.depth" segments-depth="3" segments-height="3"
      segments-width="3"></a-box>
  </a-entity>
</template>
