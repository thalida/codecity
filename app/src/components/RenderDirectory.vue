<script setup lang="ts">
import "aframe";
import "aframe-gradient-sky";
import { computed, onMounted } from "vue";
import RenderBuilding from "./RenderBuilding.vue";
import RenderRoad from "./RenderRoad.vue";

const props = defineProps(['node'])
const hasRoad = computed(() => {
  return typeof props.node.render.road !== "undefined"
})

const nodePosition = `${props.node.render.position.x} ${props.node.render.position.y} ${props.node.render.position.z}`
const nodeRotation = `${props.node.render.rotation.x} ${props.node.render.rotation.y} ${props.node.render.rotation.z}`
</script>

<template>
  <a-entity :position="nodePosition" :rotation="nodeRotation">
    <RenderRoad v-if="hasRoad" :road="props.node.render.road" />
    <a-entity v-for="childNode in node.directory.nodes" :key="childNode.path">
      <RenderBuilding v-if="childNode.type === 'blob'" :node="childNode" />
      <RenderDirectory v-else-if="childNode.type === 'tree'" :node="childNode" />
    </a-entity>
  </a-entity>
</template>
