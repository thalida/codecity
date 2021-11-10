<template>
  <div class="codecity" v-if="isReady">
    <!-- <Renderer ref="renderer" resize antialias pointer :orbit-ctrl="{}">
      <Camera :position="{ x: 0, y: 100, z: 0 }" />
      <Scene background="#ffffff">
        <AmbientLight color="#ffffff" :intensity="0.8" />
        <DirectionalLight
          color="#ffff00"
          :intensity="1"
          :position="{ x: 10, y: 10, z: 10 }"
        />
        <Group
          v-for="street in streets"
          :key="street.path"
          :rotation="{ x: 0, y: 0, z: 0 }"
          :position="street.position"
        >
          <Box
            :ref="`street-${street.path}__road`"
            :height="street.height"
            :width="street.width"
            :depth="street.depth"
          >
            <ToonMaterial color="#333" />
          </Box>
          <Group
            v-for="building in street.children.buildings"
            :key="building.path"
            :position="building.foundation.position"
          >
            <Box
              :ref="`building-${building.path}__foundation`"
              :height="building.foundation.height"
              :width="building.foundation.width"
              :depth="building.foundation.depth"
            >
              <ToonMaterial :color="building.foundation.color" />
            </Box>
            <Box
              :ref="`building-${building.path}__property`"
              :height="building.property.height"
              :width="building.property.width"
              :depth="building.property.depth"
              :position="building.property.position"
            >
              <ToonMaterial :color="building.property.color" />
            </Box>
          </Group>
        </Group>
      </Scene>
    </Renderer> -->
    <Renderer ref="renderer" resize antialias pointer :orbit-ctrl="{}">
      <Camera :position="{ x: 0, y: 100, z: 0 }" />
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
    // this.streets = this.createStreets();
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
      if (maxDepth && nodeDepth > maxDepth) {
        return;
      }

      const node = this.tree[path];

      const blockComplexity = Math.ceil(Math.log(node.stats.num_descendants));
      let blockDimensions = {
        width: 0,
        depth: 0,
        height: 0,
      };
      let roadDimensions = {
        width: 0,
        depth: this.getRoadDepth(blockComplexity, grid),
        height: grid.height,
      };

      blockDimensions.depth += roadDimensions.depth + grid.depth;

      const buildings: any[] = [];
      const intersectingBlocks: any[] = [];
      const elements: { [key: string]: any } = {};

      for (let i = 0, len = node.children.length; i < len; i += 1) {
        const childPath: string = node.children[i];
        const childNode = this.tree[childPath];

        if (childNode.type === "blob") {
          const building = this.generateBuilding(childNode, grid);
          building.position.x +=
            blockDimensions.width + building.dimensions.width / 2;

          blockDimensions.width += building.dimensions.width;
          blockDimensions.height = Math.max(
            blockDimensions.height,
            building.dimensions.height
          );
          elements[childPath] = building;
          continue;
        }

        const intersectingBlock = this.generateBlock(
          childPath,
          grid,
          nodeDepth + 1,
          maxDepth
        );

        if (typeof intersectingBlock === "undefined") {
          continue;
        }
        console.log(childPath, intersectingBlock);
        console.log(intersectingBlock.position.x, blockDimensions.width);
        intersectingBlock.position.x +=
          blockDimensions.width + intersectingBlock.dimensions.width / 2;
        elements[childPath] = intersectingBlock;

        blockDimensions.width += intersectingBlock.dimensions.width;
        blockDimensions.depth = Math.max(
          blockDimensions.depth,
          intersectingBlock.dimensions.depth
        );
        blockDimensions.height = Math.max(
          blockDimensions.height,
          intersectingBlock.dimensions.height
        );
      }

      const renderableElKeys = Object.keys(elements);
      for (let j = 0, len = renderableElKeys.length; j < len; j += 1) {
        const nodePath = renderableElKeys[j];
        const element = elements[nodePath];
        const treeNode = this.tree[nodePath];
        element.position.x = -1 * (blockDimensions.width / 2) + element.position.x;

        if (treeNode.type === "blob") {
          buildings.push(element);
        } else {
          intersectingBlocks.push(element);
        }
      }

      blockDimensions.width += grid.buffer * 2;

      roadDimensions.width = blockDimensions.width;
      const road = {
        dimensions: roadDimensions,
        position: { x: 0, y: 0, z: 0 },
      };

      const block = {
        path: path,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        dimensions: blockDimensions,
        road,
        buildings,
        intersectingBlocks,
      };

      return block;
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

      const building = {
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

      return building;
    },

    generateIntersection(node: any, grid: any) {
      const intersection = {
        dimensions: {
          width: grid.width,
          depth: grid.depth,
          height: grid.height,
        },
        position: { x: 0, y: 0, z: 0 },
      };

      return intersection;
    },

    createStreets() {
      const streets: any[] = [];
      let origin = { x: 0, y: 0, z: 0 };

      for (const path in this.tree) {
        const node = this.tree[path];
        if (node.type === "blob") {
          continue;
        }

        const street = this.createStreet(path, origin);
        streets.push(street);
        origin = {
          x: street.position.x + street.width / 2,
          y: street.position.y,
          z: street.position.z,
        };
      }
      return streets;
    },
    createStreet(path: string, origin: any) {
      const grid = { width: 3, depth: 3, height: 1 };

      const node = this.tree[path];

      const streetComplexity = Math.ceil(Math.log(node.stats.num_descendants));
      let depth;
      if (streetComplexity === 0) {
        depth = 1;
      } else if (streetComplexity > 5) {
        depth = 5;
      } else {
        depth = streetComplexity;
      }
      depth *= grid.depth;

      let street = {
        depth,
        width: node.stats.num_children * grid.width,
        height: grid.height,
        position: { ...origin },
        children: {
          buildings: [] as any,
          intersections: [] as any,
        },
      };
      street.position.x += street.width / 2;

      const baseProperty = { width: 1, depth: 1, height: 1 };
      for (let i = 0, len = node.children.length; i < len; i += 1) {
        const childPath = node.children[i];
        const childNode = this.tree[childPath];

        if (childNode.type === "tree") {
          street.children.intersections.push(childPath);
          continue;
        }

        const foundationColorG = Math.floor(Math.random() * 255);
        const foundationColorB = Math.floor(foundationColorG / 2);
        const foundation = {
          width: grid.width,
          depth: grid.depth,
          height: grid.height,
          position: { x: 0, y: 0, z: 0 },
          color: `rgb(0, ${foundationColorG}, ${foundationColorB})`,
        };

        foundation.position.x +=
          (street.width * -1) / 2 + grid.width / 2 + i * grid.width;
        foundation.position.z += -1 * (street.depth / 2 + grid.depth / 2);

        const propertyColors = {
          r: Math.floor(Math.random() * 255),
          g: Math.floor(Math.random() * 255),
          b: Math.floor(Math.random() * 255),
        };
        let property = {
          width: baseProperty.width,
          depth: baseProperty.depth,
          height: childNode.blob.stats
            ? Math.log(childNode.blob.stats.num_lines)
            : baseProperty.height,
          position: { x: 0, y: 0, z: 0 },
          color: `rgb(${propertyColors.r}, ${propertyColors.g}, ${propertyColors.b})`,
        };
        if (property.height < baseProperty.height) {
          property.height = baseProperty.height;
        }
        property.position.y += property.height / 2;

        const building = {
          foundation,
          property,
        };
        street.children.buildings.push(building);
      }

      return street;
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
