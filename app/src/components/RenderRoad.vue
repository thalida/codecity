<script setup lang="ts">
import "aframe";

import { TILE_TYPE } from "@/constants/tiles";
const props = defineProps(['node', 'tile'])
</script>

<template>
  <a-entity shadow="cast:false; receive: true">
    <a-box v-if="props.tile.type === TILE_TYPE.DIR_START && props.tile.nodePath == '.'" color="green" :height="10"
      :width="1" :depth="1"></a-box>
    <a-box v-else-if="props.tile.type === TILE_TYPE.DIR_START" color="green" :height="1" :width="1" :depth="1">
    </a-box>
    <a-box v-else-if="props.tile.type === TILE_TYPE.DIR_END" color="yellow" :height="1" :width="1" :depth="1"></a-box>
    <a-box v-else-if="props.tile.type === TILE_TYPE.CROSSWALK" color="white" :height="1" :width="1" :depth="1">
    </a-box>
    <a-box v-else-if="props.tile.type === TILE_TYPE.INTERSECTION" color="red" :height="1" :width="1" :depth="1">
    </a-box>
    <a-box v-else-if="props.tile.type === TILE_TYPE.ROAD" color="gray" :height="1" :width="1" :depth="1"></a-box>
  </a-entity>
</template>
