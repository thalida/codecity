<script setup lang="ts">
import "aframe";

const props = defineProps(['node'])
const height = props.node.file_stats.num_lines ? Math.ceil(Math.log(props.node.file_stats.num_lines)) + 2 : 2;
const position = `0 ${height / 2} 0`;
</script>

<template>
  <a-box :position="position" color="blue" :width="1" :height="height" :depth="1" shadow="cast:false; receive: true">
  </a-box>
</template>
