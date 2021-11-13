<template>
  <Group
    :ref="`building-${node.path}`"
    :position="node.render.position"
    :rotation="node.render.rotation"
    :props="{ name: `building:${node.path}` }"
  >
    <Box
      :ref="`building-${node.path}__foundation`"
      :height="node.render.foundation.dimensions.height"
      :width="node.render.foundation.dimensions.width"
      :depth="node.render.foundation.dimensions.depth"
      :position="node.render.foundation.position"
      :props="{ name: `building__foundation:${node.path}` }"
    >
      <ToonMaterial :color="node.render.foundation.color" />
    </Box>
    <Box
      :ref="`building-${node.path}__property`"
      :height="node.render.property.dimensions.height"
      :width="node.render.property.dimensions.width"
      :depth="node.render.property.dimensions.depth"
      :position="node.render.property.position"
      :props="{ name: `building__property:${node.path}` }"
    >
      <ToonMaterial :color="node.render.property.color" />
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
    node: {
      type: Object,
      required: true,
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
