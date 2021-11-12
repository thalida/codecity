<template>
  <div class="codecity" v-if="isReady">
    <Renderer ref="renderer" resize antialias pointer :orbit-ctrl="{}">
      <Camera :position="camera.position" :rotation="camera.rotation" />
      <Scene background="#ffffff">
        <AmbientLight color="#ffffff" :intensity="0.8" />
        <DirectionalLight
          color="#ffff00"
          :intensity="1"
          :position="{ x: 10, y: 10, z: 10 }"
        />
        <Neighborhood :node="city" />
      </Scene>
    </Renderer>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import axios from "axios";
import { Camera, AmbientLight, DirectionalLight, Renderer, Scene } from "troisjs";
import Neighborhood from "@/components/CodeCity/Neighborhood.vue";
import { sumObj } from "@/helpers";

interface CodeCityData {
  isReady: boolean;
  city: any;
  grid: any;
  basePropertyDimensions: any;
  maxDepth: number | undefined;
  camera: any;
}

export default defineComponent({
  name: "CodeCity",
  components: {
    Neighborhood,
    Camera,
    AmbientLight,
    DirectionalLight,
    Renderer,
    Scene,
  },
  data(): CodeCityData | Partial<CodeCityData> {
    return {
      isReady: false,
      city: null,
      grid: { width: 3, depth: 3, height: 1, buffer: 3 },
      basePropertyDimensions: { width: 1, depth: 1, height: 1 },
      maxDepth: undefined,
      camera: {},
    } as Partial<CodeCityData>;
  },
  async mounted() {
    this.city = await this.createCity();
    this.isReady = true;
    this.camera.position = { x: 0, y: 500, z: 0 };
    // this.camera.position = { x: 0, y: 0, z: 100 };
    console.log(this.city);
  },
  methods: {
    async getRepoDirTree(repo: string) {
      const loc = window.location;
      const res = await axios.get(`http://${loc.hostname}:8000/api/repos/${repo}`);
      return res.data;
    },
    async createCity() {
      // const repo = "thalida/thalida.com";
      // const repo = "xtream1101/scraperx";
      const repo = "facebook/react";
      let dirTree = await this.getRepoDirTree(repo);
      const neighborhood = this.generateNeighborhood(dirTree, ["."]);
      const city = {
        path: "thalida.com",
        neighborhood,
        render: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      };

      return city;
    },
    generateNeighborhood(dirTree: any, paths: any[], depth = 0) {
      const neighborhood: { [name: string]: any } = {
        nodes: [] as any[],
        render: {
          dimensions: {
            width: 0,
            depth: 0,
            height: 0,
          },
          sideWidth: { left: 0, right: 0, center: 0 },
          sideDepth: { left: 0, right: 0, center: 0 },
          sideHeight: { left: 0, right: 0, center: 0 },
          maxSideWidth: 0,
          maxSideDepth: 0,
          maxSideHeight: 0,
        },
      };

      if (typeof this.maxDepth !== "undefined" && depth >= this.maxDepth) {
        return neighborhood;
      }

      let plannedIntersections: any[] = [];
      for (let i = 0, len = paths.length; i < len; i += 1) {
        const nodePath = paths[i];
        const node = dirTree[nodePath];
        node.depth = depth;
        if (node.type === "blob") {
          node.render = this.getBuildingRender(node);
        } else {
          node.neighborhood = this.generateNeighborhood(
            dirTree,
            node.child_paths,
            depth + 1
          );
          node.render = this.getNeighborhoodRender(node);
        }

        neighborhood.nodes.push(node);

        if (typeof node.render === "undefined") {
          continue;
        }

        if (node.type === "tree") {
          const currIntersectionX =
            neighborhood.render.sideWidth[node.render.branchDirection] +
            node.render.buffer +
            node.neighborhood.render.sideDepth[node.render.branchDirection];

          plannedIntersections.push({
            path: node.path,
            nodeIdx: i,
            startX: currIntersectionX,
            endX: currIntersectionX + node.render.road.dimensions.depth,
          });
        }

        neighborhood.render.sideWidth[node.render.branchDirection] +=
          node.render.dimensions.width + node.render.buffer;

        neighborhood.render.sideDepth[node.render.branchDirection] = Math.max(
          neighborhood.render.sideDepth[node.render.branchDirection],
          node.render.dimensions.depth
        );
        neighborhood.render.sideHeight[node.render.branchDirection] = Math.max(
          neighborhood.render.sideHeight[node.render.branchDirection],
          node.render.dimensions.height
        );
      }

      plannedIntersections.sort((a, b) => a.startX - b.startX);
      let j = 1;
      while (j < plannedIntersections.length) {
        const nodeA = plannedIntersections[j - 1];
        const nodeB = plannedIntersections[j];
        const gap = nodeB.startX - nodeA.endX;
        const minGapSize = this.grid.buffer;

        if (gap < minGapSize) {
          const newGap = minGapSize - gap;
          for (let k = j; k < plannedIntersections.length; k += 1) {
            const nodeC = plannedIntersections[k];
            const node = neighborhood.nodes[nodeC.nodeIdx];
            node.render.intersectionBuffer += newGap;
            nodeC.intersectionPoint += newGap;
            neighborhood.render.sideWidth[node.render.branchDirection] += newGap;
          }
        }

        j += 1;
      }

      neighborhood.render.maxSideWidth = Math.max(
        ...(Object.values(neighborhood.render.sideWidth) as number[])
      );
      neighborhood.render.maxSideDepth = Math.max(
        ...(Object.values(neighborhood.render.sideDepth) as number[])
      );
      neighborhood.render.maxSideHeight = Math.max(
        ...(Object.values(neighborhood.render.sideHeight) as number[])
      );
      neighborhood.render.dimensions.width = neighborhood.render.maxSideWidth;
      neighborhood.render.dimensions.depth = sumObj(neighborhood.render.sideDepth);
      neighborhood.render.dimensions.height = sumObj(neighborhood.render.sideHeight);

      return neighborhood;
    },

    getNeighborhoodRender(node: any) {
      const blockComplexity = Math.ceil(Math.log(node.tree_stats.num_descendants));

      let render = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        branchDirection: "center",
        dimensions: { width: 0, depth: 0, height: 0 },
        buffer: this.grid.buffer,
        intersectionBuffer: 0,
        road: {
          dimensions: {
            width: 0,
            depth: this.getRoadDepth(blockComplexity),
            height: this.grid.height,
          },
          position: { x: 0, y: 0, z: 0 },
          intersections: [] as any[],
        },
      };

      render.dimensions.height = node.neighborhood.render.maxSideHeight;
      render.dimensions.depth =
        render.road.dimensions.depth + node.neighborhood.render.dimensions.depth;

      render.road.dimensions.width = node.neighborhood.render.dimensions.width;
      render.road.position.z =
        node.neighborhood.render.sideDepth.left -
        (render.dimensions.depth - render.road.dimensions.depth) / 2;

      let prevSideX: { [key: string]: number } = { left: 0, right: 0, center: 0 };
      for (let j = 0, len = node.neighborhood.nodes.length; j < len; j += 1) {
        const childNode = node.neighborhood.nodes[j];

        if (typeof childNode.render === "undefined") {
          continue;
        }

        let direction = 0;
        if (childNode.render.branchDirection === "left") {
          direction = -1;
        } else if (childNode.render.branchDirection === "right") {
          direction = 1;
        }

        const normalizedX =
          -1 * (render.road.dimensions.width / 2) +
          childNode.render.intersectionBuffer +
          prevSideX[childNode.render.branchDirection];

        childNode.render.position.x =
          normalizedX + childNode.render.dimensions.width / 2;

        childNode.render.position.z =
          direction *
            (render.road.dimensions.depth / 2 +
              childNode.render.dimensions.depth / 2) +
          render.road.position.z;

        if (childNode.type === "tree") {
          const intersection = {
            node: [childNode.path],
            render: {
              position: { x: 0, y: 0, z: 0 },
              dimensions: {
                width: childNode.render.road.dimensions.depth,
                depth: render.road.dimensions.depth,
                height: render.road.dimensions.height,
              },
              color: "#fff",
            },
          };

          intersection.render.position.x =
            normalizedX +
            intersection.render.dimensions.width / 2 +
            childNode.neighborhood.render.sideDepth[
              childNode.render.branchDirection
            ];

          render.road.intersections.push(intersection);
        }

        prevSideX[childNode.render.branchDirection] +=
          childNode.render.dimensions.width +
          childNode.render.buffer +
          childNode.render.intersectionBuffer;
      }

      render.road.dimensions.width += this.grid.buffer * 2;
      render.dimensions.width = render.road.dimensions.width;

      if (node.depth > 0) {
        render = this.setBranchDirection(render);
      }

      return render;
    },

    getBuildingRender(node: any) {
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
      let propertyHeight = node.file_stats.num_lines
        ? Math.ceil(Math.log(node.file_stats.num_lines))
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

      let render = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        dimensions: {
          width: foundation.dimensions.width,
          depth: foundation.dimensions.depth,
          height: foundation.dimensions.height + property.dimensions.height,
        },
        buffer: this.getRandomBuffer(),
        intersectionBuffer: 0,
        foundation,
        property,
        branchDirection: "center",
      };

      render = this.setBranchDirection(render);
      return render;
    },

    setBranchDirection(render: any) {
      const branchDirections: string[] = ["left", "right"];
      const origDimenions = { ...render.dimensions };
      render.branchDirection =
        branchDirections[Math.floor(Math.random() * branchDirections.length)];
      render.dimensions.width = origDimenions.depth;
      render.dimensions.depth = origDimenions.width;

      if (render.branchDirection === "left") {
        render.rotation.y = 90 * (Math.PI / 180);
      } else {
        render.rotation.y = -90 * (Math.PI / 180);
      }

      return render;
    },

    getRoadDepth(blockComplexity: number) {
      let roadDepth;
      if (blockComplexity <= 2) {
        roadDepth = 1;
      } else if (blockComplexity > 2 && blockComplexity < 6) {
        roadDepth = 2;
      } else {
        roadDepth = 3;
      }
      roadDepth *= this.grid.depth;

      return roadDepth;
    },

    getRandomBuffer() {
      return Math.floor(Math.random() * this.grid.buffer);
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
