<template>
  <Group
    :ref="`block-road`"
    :position="road.position"
    :props="{ name: `road:${road.parentPath}` }"
  >
    <Box
      :height="road.dimensions.height"
      :width="road.dimensions.width"
      :depth="road.dimensions.depth"
      :props="{ name: `road__regular:${road.parentPath}` }"
    >
      <ToonMaterial color="#333" :props="{ transparent: false, opacity: 1 }" />
    </Box>
    <Box
      v-for="(intersection, index) in road.intersections"
      :key="index"
      :ref="`intersection__${index}`"
      :height="intersection.render.dimensions.height"
      :width="intersection.render.dimensions.width"
      :depth="intersection.render.dimensions.depth"
      :position="intersection.render.position"
      :props="{ name: `road__intersection:${road.parentPath}` }"
    >
      <ToonMaterial
        :color="intersection.render.color"
        :props="{ transparent: false, opacity: 1 }"
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
