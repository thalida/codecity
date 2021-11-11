<template>
  <Group :ref="`block-road`" :position="road.position">
    <Box
      :height="road.dimensions.height"
      :width="road.dimensions.width"
      :depth="road.dimensions.depth"
    >
      <ToonMaterial color="#333" :props="{ transparent: true, opacity: 0.5 }" />
    </Box>
    <Box
      v-for="(intersection, index) in road.intersections"
      :key="index"
      :ref="`intersection__${index}`"
      :height="intersection.render.dimensions.height"
      :width="intersection.render.dimensions.width"
      :depth="intersection.render.dimensions.depth"
      :position="intersection.render.position"
    >
      <ToonMaterial
        :color="intersection.render.color"
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
    road: {
      type: Object,
      required: true,
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
