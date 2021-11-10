<template>
  <div class="codecity" v-if="isReady">
    <Renderer ref="renderer" resize antialias pointer :orbit-ctrl="{}">
      <Camera :position="{ x: 0, y: 500, z: 0 }" />
      <Scene background="#ffffff">
        <AmbientLight color="#ffffff" :intensity="0.8" />
        <DirectionalLight
          color="#ffff00"
          :intensity="1"
          :position="{ x: 10, y: 10, z: 10 }"
        />
        <CityBlock
          :block="rootBlock"
          :depth="rootBlock.depth"
          :max-depth="maxDepth"
        />
      </Scene>
    </Renderer>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import axios from "axios";
import { Camera, AmbientLight, DirectionalLight, Renderer, Scene } from "troisjs";
import CityBlock from "@/components/CityBlock.vue";

interface CodeCityData {
  isReady: boolean;
  tree: any;
  rootBlock: any;
  grid: any;
  basePropertyDimensions: any;
  maxDepth: number | undefined;
}

export default defineComponent({
  name: "CodeCity",
  components: {
    CityBlock,
    Camera,
    AmbientLight,
    DirectionalLight,
    Renderer,
    Scene,
  },
  data(): CodeCityData | Partial<CodeCityData> {
    return {
      isReady: false,
      tree: null,
      rootBlock: null,
      grid: { width: 3, depth: 3, height: 1, buffer: 3 },
      basePropertyDimensions: { width: 1, depth: 1, height: 1 },
    } as Partial<CodeCityData>;
  },
  async mounted() {
    this.tree = await this.getTree();
    this.rootBlock = this.createCity();
    this.isReady = true;
    console.log(this.rootBlock);
  },
  methods: {
    async getTree() {
      const loc = window.location;
      const res = await axios.get(
        `http://${loc.hostname}:8000/api/repos/thalida.com`
      );
      return res.data;
    },
    createCity() {
      return this.generateBlock(".");
    },
    generateBlock(path: string, nodeDepth = 0) {
      if (typeof this.maxDepth !== "undefined" && nodeDepth > this.maxDepth) {
        return;
      }

      const node = this.tree[path];
      const blockComplexity = Math.ceil(Math.log(node.stats.num_descendants));
      let block = {
        node,
        type: node.type,
        path: path,
        depth: nodeDepth,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        dimensions: { width: 0, depth: 0, height: this.grid.height },
        buffer: this.grid.buffer,
        road: {
          dimensions: {
            width: 0,
            depth: this.getRoadDepth(blockComplexity),
            height: this.grid.height,
          },
          position: { x: 0, y: 0, z: 0 },
        },
        elements: [] as any[],
      };

      const childElements = this.generateChildElements(node, nodeDepth);
      block.elements = childElements.elements;
      block.road.dimensions.width = childElements.width;

      block.dimensions.depth =
        block.road.dimensions.depth +
        childElements.maxDepth.left +
        childElements.maxDepth.right;
      block.dimensions.height += childElements.maxHeight;

      block.road.position.z =
        childElements.maxDepth.left -
        (block.dimensions.depth - block.road.dimensions.depth) / 2;

      let lastX = 0;
      for (let j = 0, len = block.elements.length; j < len; j += 1) {
        const element = block.elements[j];
        element.position.x = lastX;
        element.position.x +=
          -1 * (block.road.dimensions.width / 2) + element.dimensions.width / 2;
        element.position.z = block.road.position.z;
        if (element.branchDirection === "right") {
          element.position.z +=
            block.road.dimensions.depth / 2 + element.dimensions.depth / 2;
        } else {
          element.position.z -=
            block.road.dimensions.depth / 2 + element.dimensions.depth / 2;
        }
        lastX += element.dimensions.width + element.buffer;
      }

      block.road.dimensions.width += this.grid.buffer * 2;
      block.dimensions.width = block.road.dimensions.width;

      if (nodeDepth > 0) {
        block = this.setRotation(block);
      }
      return block;
    },

    generateChildElements(node: any, depth: number) {
      const elements: any[] = [];
      let maxDepth: { [key: string]: number } = { left: 0, right: 0 };
      let maxHeight = 0;
      let width = 0;
      for (let i = 0, len = node.children.length; i < len; i += 1) {
        const childPath: string = node.children[i];
        const childNode = this.tree[childPath];

        let element: any = null;
        if (childNode.type === "blob") {
          element = this.generateBuilding(childNode);
        } else {
          element = this.generateBlock(childPath, depth + 1);
        }

        if (typeof element === "undefined") {
          continue;
        }

        width += element.dimensions.width + element.buffer;
        maxDepth[element.branchDirection] = Math.max(
          maxDepth[element.branchDirection],
          element.dimensions.depth
        );
        maxHeight = Math.max(maxHeight, element.dimensions.height);
        elements.push(element);
      }

      return {
        elements,
        width,
        maxDepth,
        maxHeight,
      };
    },

    generateBuilding(node: any) {
      const foundationColorG = Math.floor(Math.random() * 255);
      const foundationColorB = Math.floor(foundationColorG / 2);
      const foundation = {
        color: `rgb(0, ${foundationColorG}, ${foundationColorB})`,
        dimensions: {
          width: this.grid.width,
          depth: this.grid.depth,
          height: this.grid.height,
        },
        position: { x: 0, y: 0, z: 0 },
      };
      const propertyColors = {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
      };
      let propertyHeight = node.blob.stats
        ? Math.ceil(Math.log(node.blob.stats.num_lines))
        : this.basePropertyDimensions.height;
      if (propertyHeight < this.basePropertyDimensions.height) {
        propertyHeight = this.basePropertyDimensions.height;
      }

      let property = {
        color: `rgb(${propertyColors.r}, ${propertyColors.g}, ${propertyColors.b})`,
        dimensions: {
          width: this.basePropertyDimensions.width,
          depth: this.basePropertyDimensions.depth,
          height: propertyHeight,
        },
        position: {
          x: 0,
          y: propertyHeight / 2,
          z: 0,
        },
      };

      let building = {
        node,
        type: node.type,
        path: node.path,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        dimensions: {
          width: foundation.dimensions.width,
          depth: foundation.dimensions.depth,
          height: foundation.dimensions.height + property.dimensions.height,
        },
        buffer: 0,
        foundation,
        property,
      };

      building = this.setRotation(building);

      return building;
    },

    setRotation(element: any) {
      const branchDirections: string[] = ["left", "right"];
      const origDimenions = { ...element.dimensions };
      element.branchDirection =
        branchDirections[Math.floor(Math.random() * branchDirections.length)];
      element.dimensions.width = origDimenions.depth;
      element.dimensions.depth = origDimenions.width;

      if (element.branchDirection === "left") {
        element.rotation.y = -90 * (Math.PI / 180);
      } else {
        element.rotation.y = 90 * (Math.PI / 180);
      }

      return element;
    },

    getRoadDepth(blockComplexity: number) {
      let roadDepth;
      if (blockComplexity <= 1) {
        roadDepth = 1;
      } else if (blockComplexity > 1 && blockComplexity < 4) {
        roadDepth = 2;
      } else {
        roadDepth = 3;
      }
      roadDepth *= this.grid.depth;

      return roadDepth;
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">
.codecity {
  width: 100vw;
  height: 100vh;
}
</style>
