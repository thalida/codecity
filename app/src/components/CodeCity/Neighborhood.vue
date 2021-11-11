<template>
  <Group
    :ref="`neighborhood-${node.path}`"
    :position="node.render.position"
    :rotation="node.render.rotation"
  >
    <!-- <Box
      :ref="`block-${node.path}__district`"
      :width="node.dimensions.width"
      :depth="node.dimensions.depth"
      :height="1"
      :rotation="node.rotation"
    >
      <ToonMaterial color="#ff0000" :props="{ transparent: true, opacity: 0.2 }" />
    </Box> -->
    <Road v-if="hasRoad" :road="node.render.road" />
    <div v-for="childNode in node.neighborhood.nodes" :key="childNode.path">
      <div v-if="childNode.type === 'blob'">
        <Building :node="childNode" />
      </div>
      <div v-else-if="childNode.type === 'tree'">
        <Neighborhood :node="childNode" />
      </div>
    </div>
  </Group>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Group } from "troisjs";
import Road from "@/components/CodeCity/Road.vue";
import Building from "@/components/CodeCity/Building.vue";

export default defineComponent({
  name: "Neighborhood",
  components: {
    Group,
    Road,
    Building,
  },
  props: {
    node: {
      type: Object,
      required: true,
    },
  },
  computed: {
    hasRoad() {
      return typeof this.node.render.road !== "undefined";
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
