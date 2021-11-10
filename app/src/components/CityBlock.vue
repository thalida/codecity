<template>
  <Group
    :ref="`block-${block.path}`"
    :position="block.position"
    :rotation="block.rotation"
  >
    <Box
      :ref="`block-${block.path}__road`"
      :height="block.road.dimensions.height"
      :width="block.road.dimensions.width"
      :depth="block.road.dimensions.depth"
      :position="block.road.position"
    >
      <ToonMaterial color="#333" :props="{ transparent: true, opacity: 0.5 }" />
    </Box>
    <Group
      v-for="building in block.buildings"
      :ref="`building-${building.path}`"
      :key="building.path"
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
    <div v-if="shouldRenderNextLevel">
      <CityBlock
        v-for="intersectingBlock in block.intersectingBlocks"
        :key="intersectingBlock.path"
        :block="intersectingBlock"
        :depth="depth + 1"
        :maxDepth="maxDepth"
      />
    </div>
  </Group>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Group, Box, ToonMaterial } from "troisjs";

export default defineComponent({
  name: "CityBlock",
  components: {
    Group,
    Box,
    ToonMaterial,
  },
  props: {
    block: {
      type: Object,
      required: true,
    },
    maxDepth: {
      type: Number,
      required: false,
      default: null,
    },
    depth: {
      type: Number,
      required: true,
    },
  },
  computed: {
    hasIntersectingBlocks() {
      return this.block.intersectingBlocks.length > 0;
    },
    shouldRenderNextLevel() {
      if (typeof this.maxDepth === "undefined" || this.maxDepth === null) {
        return true;
      }

      return this.depth + 1 < this.maxDepth;
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
