<template>
  <Group
    :ref="`building-${building.path}`"
    :position="building.position"
    :rotation="building.rotation"
  >
    <Box
      :ref="`building-${building.path}__foundation`"
      :height="building.foundation.dimensions.height"
      :width="building.foundation.dimensions.width"
      :depth="building.foundation.dimensions.depth"
      :position="building.foundation.position"
    >
      <ToonMaterial :color="building.foundation.color" />
    </Box>
    <Box
      :ref="`building-${building.path}__property`"
      :height="building.property.dimensions.height"
      :width="building.property.dimensions.width"
      :depth="building.property.dimensions.depth"
      :position="building.property.position"
    >
      <ToonMaterial :color="building.property.color" />
    </Box>
  </Group>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Group, Box, ToonMaterial } from "troisjs";

export default defineComponent({
  name: "Building",
  components: {
    Group,
    Box,
    ToonMaterial,
  },
  props: {
    building: {
      type: Object,
      required: true,
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
