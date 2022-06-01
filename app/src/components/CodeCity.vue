<script setup lang="ts">
import axios from "axios";
import { computed } from "vue";
import { getObjectMaxValue, sumObj } from "@/helpers";
import RenderCity from "./RenderCity.vue";

const props = defineProps(['repoUrl'])
const debugOptions = {
  maxDepth: undefined,
}
const grid = { width: 1, depth: 1, height: 1, buffer: 1 };
const basePropertyDimensions = { width: 1, depth: 1, height: 2 };

const repoData = await getRepoDirTree();
const city = computed(generateCity);
console.log(city.value);


async function getRepoDirTree() {
  const loc = window.location;
  const res = await axios.get(`http://${loc.hostname}:8000/api/repo`, {
    params: {
      url: props.repoUrl,
    },
  });

  return res.data;
}

function generateCity() {
  const neighborhood = generateNeighborhood(repoData.tree, ["."]);
  const city = {
    path: props.repoUrl,
    neighborhood,
    render: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  };

  return city;
}


function generateNeighborhood(dirTree: any, paths: any[], depth = 0) {
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

  if (typeof debugOptions.maxDepth !== "undefined" && depth >= debugOptions.maxDepth) {
    return neighborhood;
  }

  let plannedIntersections: any[] = [];
  for (let i = 0, len = paths.length; i < len; i += 1) {
    const nodePath = paths[i];
    const node = dirTree[nodePath];
    node.depth = depth;
    if (node.type === "blob") {
      node.render = getBuildingRender(node);
    } else {
      node.neighborhood = generateNeighborhood(
        dirTree,
        node.child_paths,
        depth + 1
      );
      node.render = getNeighborhoodRender(node);
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
    const minGapSize = grid.buffer;

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

  neighborhood.render.maxSideWidth = getObjectMaxValue(neighborhood.render.sideWidth);
  neighborhood.render.maxSideDepth = getObjectMaxValue(neighborhood.render.sideDepth);
  neighborhood.render.maxSideHeight = getObjectMaxValue(neighborhood.render.sideHeight);

  neighborhood.render.dimensions.width = neighborhood.render.maxSideWidth;
  neighborhood.render.dimensions.depth = sumObj(neighborhood.render.sideDepth);
  neighborhood.render.dimensions.height = sumObj(neighborhood.render.sideHeight);

  return neighborhood;
}

function getNeighborhoodRender(node: any) {
  const blockComplexity = Math.ceil(Math.log(node.tree_stats.num_descendants));

  let render = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    branchDirection: "center",
    dimensions: { width: 0, depth: 0, height: 0 },
    buffer: grid.buffer,
    intersectionBuffer: 0,
    road: {
      parentPath: node.path,
      dimensions: {
        width: 0,
        depth: getRoadDepth(blockComplexity),
        height: grid.height,
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

  render.road.dimensions.width += grid.buffer * 2;
  render.dimensions.width = render.road.dimensions.width;

  if (node.depth > 0) {
    render = setBranchDirection(render);
  }

  return render;
}

function getBuildingRender(node: any) {
  let propertyHeight = node.file_stats.num_lines
    ? Math.ceil(Math.log(node.file_stats.num_lines) / Math.log(3)) * 1
    : basePropertyDimensions.height;
  if (propertyHeight < basePropertyDimensions.height) {
    propertyHeight = basePropertyDimensions.height;
  }

  let property = {
    dimensions: {
      width: propertyHeight / 4,
      depth: propertyHeight / 4,
      height: propertyHeight,
    },
    position: {
      x: 0,
      y: propertyHeight / 2,
      z: 0,
    },
  };

  const foundation = {
    dimensions: {
      width: property.dimensions.width + property.dimensions.width / 2,
      depth: property.dimensions.depth + property.dimensions.depth / 2,
      height: grid.height,
    },
    position: { x: 0, y: 0, z: 0 },
  };

  let render = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: {
      width: foundation.dimensions.width,
      depth: foundation.dimensions.depth,
      height: foundation.dimensions.height + property.dimensions.height,
    },
    buffer: getRandomBuffer(),
    intersectionBuffer: 0,
    foundation,
    property,
    branchDirection: "center",
  };

  render = setBranchDirection(render);
  return render;
}

function setBranchDirection(render: any) {
  const branchDirections: string[] = ["left", "right"];
  const origDimenions = { ...render.dimensions };
  render.branchDirection =
    branchDirections[Math.floor(Math.random() * branchDirections.length)];
  render.dimensions.width = origDimenions.depth;
  render.dimensions.depth = origDimenions.width;

  if (render.branchDirection === "left") {
    render.rotation.y = 90;
  } else {
    render.rotation.y = -90;
  }

  return render;
}

function getRoadDepth(blockComplexity: number) {
  let roadDepth;
  if (blockComplexity <= 2) {
    roadDepth = 2;
  } else if (blockComplexity > 2 && blockComplexity < 6) {
    roadDepth = 4;
  } else {
    roadDepth = 6;
  }
  roadDepth *= grid.depth;

  return roadDepth;
}

function getRandomBuffer() {
  return Math.floor(Math.random() * grid.buffer);
}
</script>

<template>
  <div>
    <RenderCity :city="city" />
  </div>
</template>
