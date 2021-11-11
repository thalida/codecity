<template>
  <Group :ref="`block-${path}__road`" :position="road.position">
    <Box
      :height="road.dimensions.height"
      :width="road.dimensions.width"
      :depth="road.dimensions.depth"
    >
      <ToonMaterial color="#333" :props="{ transparent: true, opacity: 0.5 }" />
    </Box>
    <Box
      v-for="(intersection, index) in road.segments"
      :key="index"
      :ref="`block-${path}__road__${index}`"
      :height="intersection.dimensions.height"
      :width="intersection.dimensions.width"
      :depth="intersection.dimensions.depth"
      :position="intersection.position"
    >
      <ToonMaterial
        :color="intersection.color"
        :props="{ transparent: true, opacity: 0.5 }"
      />
    </Box>
  </Group>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Group, Box, ToonMaterial } from "troisjs";

export default defineComponent({
  name: "Road",
  components: {
    Group,
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
