<template>
  <Box
    :ref="`block-${path}__road`"
    :height="road.dimensions.height"
    :width="road.dimensions.width"
    :depth="road.dimensions.depth"
    :position="road.position"
  >
    <ToonMaterial color="#333" :props="{ transparent: true, opacity: 0.5 }" />
  </Box>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Box, ToonMaterial } from "troisjs";

export default defineComponent({
  name: "Road",
  components: {
    Box,
    ToonMaterial,
  },
  props: {
    path: { type: String, required: true },
    road: {
      type: Object,
      required: true,
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
