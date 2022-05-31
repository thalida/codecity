<template>
  <Group
    :ref="`neighborhood:${node.path}`"
    :position="node.render.position"
    :rotation="node.render.rotation"
    :props="{ name: node.path }"
  >
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
import { Group, PointLight } from "troisjs";
import Road from "@/components/CodeCity/Road.vue";
import Building from "@/components/CodeCity/Building.vue";

export default defineComponent({
  name: "Neighborhood",
  components: {
    Group,
    Road,
    Building,
    // PointLight,
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
