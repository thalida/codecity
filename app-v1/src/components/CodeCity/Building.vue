<template>
  <Group
    :ref="`building-${node.path}`"
    :position="node.render.position"
    :rotation="node.render.rotation"
    :props="{ name: `building:${node.path}` }"
  >
    <Box
      :ref="`building-${node.path}__property`"
      :height="node.render.property.dimensions.height"
      :width="node.render.property.dimensions.width"
      :depth="node.render.property.dimensions.depth"
      :position="node.render.property.position"
      :props="{ name: `building__property:${node.path}` }"
      :cast-shadow="true"
      :receive-shadow="true"
    >
      <ToonMaterial :color="buildingColor" :props="buildingMaterialProps" />
    </Box>
    <Box
      :ref="`building-${node.path}__foundation`"
      :height="node.render.foundation.dimensions.height"
      :width="node.render.foundation.dimensions.width"
      :depth="node.render.foundation.dimensions.depth"
      :position="node.render.foundation.position"
      :props="{ name: `building__foundation:${node.path}` }"
      :receive-shadow="true"
    >
      <ToonMaterial :color="foundationColor" />
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
  data() {
    return {
      buildingColor: "",
      foundationColor: "",
      buildingMaterialProps: {},
    };
  },
  mounted() {
    // this.buildingMaterialProps = { metalness: 0.8, roughness: 0.5 };
    // this.buildingMaterialProps = { shininess: 1, flatShading: false };

    const extGroup: { [index: string]: string } = {
      ts: "js",
      js: "js",
      jsx: "js",
      vue: "js",
      css: "css",
      html: "html",
      md: "md",
    };
    const colorRanges: { [index: string]: any[] } = {
      js: [
        [50, 120, 255],
        [150, 120, 255],
      ],
      css: [
        [120, 50, 120],
        [170, 50, 120],
      ],
      html: [
        [100, 50, 120],
        [0, 50, 120],
      ],
      md: [
        [100, 120, 120],
        [0, 120, 120],
      ],
    };
    this.foundationColor = "rgb(127, 127, 127)";
    const ext = this.node.suffix.replace(/^\./, "");
    if (ext in extGroup) {
      const range = colorRanges[extGroup[ext]];
      const r = this.randomIntFromInterval(range[0][0], range[1][0]);
      const g = this.randomIntFromInterval(range[0][1], range[1][1]);
      const b = this.randomIntFromInterval(range[0][2], range[1][2]);
      this.buildingColor = `rgb(${r},${g},${b})`;
    } else {
      console.log(ext);
    }

    // const propertyColors = {
    //   r: Math.floor(Math.random() * 255),
    //   g: Math.floor(Math.random() * 255),
    //   b: Math.floor(Math.random() * 255),
    // };
  },
  methods: {
    randomIntFromInterval(min: number, max: number) {
      return Math.floor(Math.random() * (max - min + 1) + min);
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss"></style>
