<template>
  <Group
    :ref="`block-${block.path}`"
    :position="block.position"
    :rotation="block.rotation"
  >
    <!-- <Box
      :ref="`block-${block.path}__district`"
      :width="block.dimensions.width"
      :depth="block.dimensions.depth"
      :height="1"
      :rotation="block.rotation"
    >
      <ToonMaterial color="#ff0000" :props="{ transparent: true, opacity: 0.2 }" />
    </Box> -->
    <Road :path="block.path" :road="block.road" />
    <Building
      v-for="building in block.buildings"
      :key="building.path"
      :building="building"
    />
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
import { Group } from "troisjs";
import Road from "@/components/Road.vue";
import Building from "@/components/Building.vue";

export default defineComponent({
  name: "CityBlock",
  components: {
    Group,
    Road,
    Building,
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

      return this.depth + 1 <= this.maxDepth;
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
