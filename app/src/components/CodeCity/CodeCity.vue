<template>
  <div class="codecity">
    <div class="cursor"></div>
    <Renderer ref="renderer" resize antialias pointer shadow>
      <Camera
        :position="camera.position"
        :rotation="camera.rotation"
        :look-at="camera.lookAt"
      />
      <Scene ref="scene" background="#ffffff">
        <div v-if="isReady">
          <AmbientLight color="#eee" :intensity="0.4" />
          <DirectionalLight
            color="#ffffff"
            :intensity="1"
            :position="light.position"
            cast-shadow
            :shadow-map-size="{ width: 2048, height: 2048 }"
          />
          <Mesh ref="imesh">
            <SphereGeometry :radius="worldSize"></SphereGeometry>
            <BasicMaterial color="#88c4ef" :props="{ side: BackSide }" />
          </Mesh>
          <Neighborhood :node="city" />
          <Plane
            :width="worldSize"
            :height="worldSize"
            :position="{ x: 0, y: 0.4, z: 0 }"
            :rotation="{ x: -Math.PI / 2 }"
            receive-shadow
          >
            <StandardMaterial color="#44c560" />
          </Plane>
        </div>
      </Scene>
    </Renderer>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import axios from "axios";
import {
  Camera,
  AmbientLight,
  DirectionalLight,
  Renderer,
  Scene,
  RendererPublicInterface,
  Plane,
  Mesh,
  SphereGeometry,
  BasicMaterial,
  StandardMaterial,
} from "troisjs";
import {
  Camera as ThreeCamera,
  Vector3,
  Raycaster,
  BackSide,
  Fog,
  Scene as ThreeScene,
} from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import Neighborhood from "@/components/CodeCity/Neighborhood.vue";
import { sumObj } from "@/helpers";
interface CodeCityData {
  isReady: boolean;
  city: any;
  grid: any;
  basePropertyDimensions: any;
  maxDepth: number | undefined;
  camera: any;
  light: any;
  worldSize: number;
  BackSide: any;
}

export default defineComponent({
  name: "CodeCity",
  components: {
    Neighborhood,
    Renderer,
    Scene,
    Camera,
    Plane,
    Mesh,
    SphereGeometry,
    BasicMaterial,
    StandardMaterial,
    AmbientLight,
    DirectionalLight,
  },
  props: {
    repoUrl: {
      type: String,
      required: true,
    },
  },
  data(): CodeCityData | Partial<CodeCityData> {
    return {
      isReady: false,
      city: null,
      grid: { width: 3, depth: 3, height: 1, buffer: 3 },
      basePropertyDimensions: { width: 3, depth: 3, height: 3 },
      maxDepth: undefined,
      BackSide: BackSide,
      worldSize: 0,
      camera: {},
      light: {},
    } as Partial<CodeCityData>;
  },
  async mounted() {
    this.city = await this.createCity();
    this.worldSize = Math.max(
      this.city.neighborhood.render.dimensions.width,
      this.city.neighborhood.render.dimensions.depth
    );
    this.isReady = true;
    const renderer = this.$refs.renderer as RendererPublicInterface;
    const camera = renderer.camera as ThreeCamera;
    const domElement = renderer.renderer.domElement;
    const controls = new PointerLockControls(camera, domElement);

    const scene = (this.$refs.scene as any).scene as ThreeScene;
    scene.fog = new Fog(0xeeeee, 200, 500);

    const rootRoad = this.city.neighborhood.nodes[0].render.road;
    const cameraPosition = { ...rootRoad.position };
    cameraPosition.x -= rootRoad.dimensions.width / 2 - this.grid.buffer;
    cameraPosition.y = rootRoad.dimensions.height;
    this.camera.position = cameraPosition;
    this.camera.lookAt = { x: 0, y: cameraPosition.y, z: cameraPosition.z };

    this.light.position = { x: -5, y: 5, z: -5 };

    let prevTime = performance.now() as number;
    const velocity = new Vector3();
    const direction = new Vector3();
    const raycaster = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 10);

    const move = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    const onKeyDown = function (event: KeyboardEvent) {
      if (typeof renderer.scene === "undefined") {
        return;
      }
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          move.forward = true;
          break;

        case "ArrowLeft":
        case "KeyA":
          move.left = true;
          break;

        case "ArrowDown":
        case "KeyS":
          move.backward = true;
          break;

        case "ArrowRight":
        case "KeyD":
          move.right = true;
          break;
      }
    };

    const onKeyUp = function (event: KeyboardEvent) {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          move.forward = false;
          break;

        case "ArrowLeft":
        case "KeyA":
          move.left = false;
          break;

        case "ArrowDown":
        case "KeyS":
          move.backward = false;
          break;

        case "ArrowRight":
        case "KeyD":
          move.right = false;
          break;
      }
    };

    domElement.addEventListener("click", function () {
      controls.lock();
    });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    let lastSafePosition = camera.position;
    renderer.onBeforeRender(() => {
      const time = performance.now();
      if (renderer.scene && controls.isLocked === true) {
        raycaster.ray.origin.copy(camera.position);
        const intersections = raycaster.intersectObjects(
          renderer.scene.children,
          true
        );
        const hasIntersections = intersections.length > 0;
        const object = hasIntersections ? intersections[0].object : null;

        if (object !== null && object.name.indexOf("road") == 0) {
          const delta = (time - prevTime) / 1000;

          lastSafePosition = camera.position.clone();
          velocity.x -= velocity.x * 10.0 * delta;
          velocity.z -= velocity.z * 10.0 * delta;

          direction.z = Number(move.forward) - Number(move.backward);
          direction.x = Number(move.right) - Number(move.left);
          direction.normalize();

          if (move.forward || move.backward)
            velocity.z -= direction.z * 400.0 * delta;
          if (move.left || move.right) velocity.x -= direction.x * 400.0 * delta;

          controls.moveRight(-velocity.x * delta);
          controls.moveForward(-velocity.z * delta);
        } else {
          camera.position.copy(lastSafePosition);
        }
      }

      prevTime = time;
    });
    console.log(this.city);
  },
  methods: {
    async getRepoDirTree() {
      const loc = window.location;
      const res = await axios.get(`http://${loc.hostname}:8000/api/repo`, {
        params: {
          url: this.repoUrl,
        },
      });
      return res.data.tree;
    },
    async createCity() {
      let dirTree = await this.getRepoDirTree();
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

      neighborhood.plannedIntersections = plannedIntersections;

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
          parentPath: node.path,
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
              position: { x: 0, y: 0.5, z: 0 },
              dimensions: {
                width: childNode.render.road.dimensions.depth,
                depth: render.road.dimensions.depth,
                height: 0.1,
              },
              color: "#666",
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
      // const foundationColorB = Math.floor(foundationColorG / 2);
      const foundation = {
        color: `rgb(${foundationColorG}, ${foundationColorG}, ${foundationColorG})`,
        dimensions: {
          width: this.grid.width * 2,
          depth: this.grid.depth * 2,
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
        ? Math.ceil(Math.log(node.file_stats.num_lines)) * 2
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
        roadDepth = 2;
      } else if (blockComplexity > 2 && blockComplexity < 6) {
        roadDepth = 4;
      } else {
        roadDepth = 6;
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
  .cursor {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);

    width: 5px;
    height: 5px;
    background: rgba(255, 255, 255, 0.5);
  }
}
</style>
