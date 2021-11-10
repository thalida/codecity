<template>
  <div class="codecity" v-if="isReady">
    <Renderer ref="renderer" resize antialias pointer :orbit-ctrl="{}">
      <Camera :position="{ x: 0, y: 200, z: 0 }" />
      <Scene background="#ffffff">
        <AmbientLight color="#ffffff" :intensity="0.8" />
        <DirectionalLight
          color="#ffff00"
          :intensity="1"
          :position="{ x: 10, y: 10, z: 10 }"
        />
        <CityBlock :block="rootBlock" :depth="nodeDepth" :max-depth="maxDepth" />
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
  tree: any;
  streets: any;
  rootBlock: any;
  isReady: boolean;
  nodeDepth: number;
  maxDepth: number | null | undefined;
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
  data(): CodeCityData {
    return {
      tree: null,
      streets: null,
      rootBlock: null,
      nodeDepth: 0,
      maxDepth: null,
      isReady: false,
    };
  },
  async mounted() {
    const loc = window.location;
    const res = await axios.get(`http://${loc.hostname}:8000/api/repos/thalida.com`);
    this.tree = res.data;
    this.rootBlock = this.createCity();
    this.isReady = true;
    console.log(this.rootBlock);
  },
  methods: {
    createCity() {
      const grid = { width: 3, depth: 3, height: 1, buffer: 3 };
      return this.generateBlock(".", grid, this.nodeDepth, this.maxDepth);
    },
    generateBlock(
      path: string,
      grid: any,
      nodeDepth: number,
      maxDepth: number | null | undefined
    ) {
      if (
        typeof maxDepth !== "undefined" &&
        maxDepth !== null &&
        nodeDepth > maxDepth
      ) {
        console.log("max depth reached");
        return;
      }

      const node = this.tree[path];

      const blockComplexity = Math.ceil(Math.log(node.stats.num_descendants));
      let roadDimensions = {
        width: 0,
        depth: this.getRoadDepth(blockComplexity, grid),
        height: grid.height,
      };
      let blockDimensions = {
        width: 0,
        depth: 0,
        height: grid.height,
      };

      const elements: { [key: string]: any } = {};
      let maxElementDepth: { [key: string]: number } = { left: 0, right: 0 };
      let maxElementHeight = 0;

      for (let i = 0, len = node.children.length; i < len; i += 1) {
        const childPath: string = node.children[i];
        const childNode = this.tree[childPath];
        let element: any = null;

        if (childNode.type === "blob") {
          element = this.generateBuilding(childNode, grid);
        } else {
          element = this.generateBlock(childPath, grid, nodeDepth + 1, maxDepth);

          if (typeof element === "undefined") {
            continue;
          }
        }

        element.position.x = roadDimensions.width;
        roadDimensions.width += element.dimensions.width;

        if (element.branchDirection) {
          maxElementDepth[element.branchDirection] = Math.max(
            maxElementDepth[element.branchDirection],
            element.dimensions.depth
          );
        }

        maxElementHeight = Math.max(maxElementHeight, element.dimensions.height);
        elements[childPath] = element;
      }

      blockDimensions.depth =
        roadDimensions.depth + maxElementDepth.left + maxElementDepth.right;
      blockDimensions.height += maxElementHeight;

      const road = { dimensions: roadDimensions, position: { x: 0, y: 0, z: 0 } };
      road.position.z =
        maxElementDepth.left - (blockDimensions.depth - road.dimensions.depth) / 2;

      const buildings: any[] = [];
      const intersectingBlocks: any[] = [];
      const renderableElKeys = Object.keys(elements);
      for (let j = 0, len = renderableElKeys.length; j < len; j += 1) {
        const nodePath = renderableElKeys[j];
        const element = elements[nodePath];
        const treeNode = this.tree[nodePath];

        element.position.x +=
          -1 * (road.dimensions.width / 2) + element.dimensions.width / 2;
        element.position.z = road.position.z;
        if (element.branchDirection === "right") {
          element.position.z +=
            roadDimensions.depth / 2 + element.dimensions.depth / 2;
        } else {
          element.position.z -=
            roadDimensions.depth / 2 + element.dimensions.depth / 2;
        }

        if (treeNode.type === "blob") {
          buildings.push(element);
        } else {
          intersectingBlocks.push(element);
        }
      }

      road.dimensions.width += grid.buffer * 2;
      blockDimensions.width = road.dimensions.width;
      let block = {
        path: path,
        maxElementDepth,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        dimensions: blockDimensions,
        road,
        buildings,
        intersectingBlocks,
      };

      if (nodeDepth > 0) {
        block = this.setRotation(block);
      }
      return block;
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

    getRoadDepth(blockComplexity: number, grid: any) {
      let roadDepth;
      if (blockComplexity <= 1) {
        roadDepth = 1;
      } else if (blockComplexity > 1 && blockComplexity < 4) {
        roadDepth = 2;
      } else {
        roadDepth = 3;
      }
      roadDepth *= grid.depth;

      return roadDepth;
    },

    generateBuilding(node: any, grid: any) {
      const foundationColorG = Math.floor(Math.random() * 255);
      const foundationColorB = Math.floor(foundationColorG / 2);
      const foundation = {
        color: `rgb(0, ${foundationColorG}, ${foundationColorB})`,
        dimensions: {
          width: grid.width,
          depth: grid.depth,
          height: grid.height,
        },
        position: { x: 0, y: 0, z: 0 },
      };

      const basePropertyDimensions = { width: 1, depth: 1, height: 1 };
      const propertyColors = {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
      };
      let propertyHeight = node.blob.stats
        ? Math.ceil(Math.log(node.blob.stats.num_lines))
        : basePropertyDimensions.height;
      if (propertyHeight < basePropertyDimensions.height) {
        propertyHeight = basePropertyDimensions.height;
      }

      let property = {
        color: `rgb(${propertyColors.r}, ${propertyColors.g}, ${propertyColors.b})`,
        dimensions: {
          width: basePropertyDimensions.width,
          depth: basePropertyDimensions.depth,
          height: propertyHeight,
        },
        position: {
          x: 0,
          y: propertyHeight / 2,
          z: 0,
        },
      };

      let building = {
        path: node.path,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        dimensions: {
          width: foundation.dimensions.width,
          depth: foundation.dimensions.depth,
          height: foundation.dimensions.height + property.dimensions.height,
        },
        foundation,
        property,
      };

      building = this.setRotation(building);

      return building;
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
