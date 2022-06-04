<script setup lang="ts">
import axios from "axios";
import { cloneDeep } from "lodash-es";
import RenderGrid from "./RenderGrid.vue";

const props = defineProps(['repoUrl'])
const repoData = await fetchRepo();
const repoTree = repoData.tree;
console.log(repoTree);
const dirsByDepth = getDirsByDepth(repoTree);
// const maxDepth = Object.keys(dirsByDepth).length - 1;
const maxDepth = 3;
const dirGrids = getDirGrids(repoTree, dirsByDepth, maxDepth);
combineGrids();

const rootGrid = dirGrids['.'].grid;

// console.log(rootGrid);

async function fetchRepo() {
  const loc = window.location;
  const res = await axios.get(`http://${loc.hostname}:8000/api/repo`, {
    params: {
      url: props.repoUrl,
    },
  });

  return res.data;
}

function getDirsByDepth(tree) {
  const dirsByDepth: any = {};
  for (const nodePath in tree) {
    if (tree.hasOwnProperty(nodePath)) {
      const node = tree[nodePath];
      if (node.type === "tree") {
        dirsByDepth[node.depth] = dirsByDepth[node.depth] || [];
        dirsByDepth[node.depth].push(node.path);
      }
    }
  }

  return dirsByDepth;
}

function getDirGrids(repoTree, dirsByDepth, maxDepth) {
  const dirGrids: any = {};
  for (let d = maxDepth; d >= 0; d -= 1) {
    const dirs = dirsByDepth[d];
    const numDirs = dirs.length;

    for (let i = 0; i < numDirs; i += 1) {
      const dirPath = dirs[i];
      const dir = repoTree[dirPath];
      const dirGrid: any = {};
      const dirIntersections: any = {};


      dirGrid[0] = { 0: ['S', dirPath] };

      let intersectionOffset = 1;
      for (let j = 0; j < dir.tree_stats.num_children; j += 1) {
        const child = repoTree[dir.child_paths[j]];
        let gridX = Math.floor(j / 2) + intersectionOffset;
        const gridY = j % 2 === 0 ? 1 : -1;

        if (child.type === "blob") {
          if (dirGrid[gridX] && dirGrid[gridX][0][0] === 'C') {
            intersectionOffset += 1;
            gridX += 1;
          }

          if (typeof dirGrid[gridX] === 'undefined') {
            dirGrid[gridX] = {};
          }

          dirGrid[gridX][0] = ['R'];
          dirGrid[gridX][gridY] = ['B', child.path];
        } else {
          let shiftXBy = 0;

          if (dirGrid[gridX]) {
            shiftXBy += 1;
          }

          if (dirGrid[gridX + shiftXBy - 1][0][0] === 'C') {
            dirGrid[gridX + shiftXBy] = { 0: ['R'] };
            shiftXBy += 1;
          }

          dirGrid[gridX + shiftXBy] = { '-1': ['C', child.path], 0: ['C', child.path], 1: ['C', child.path] };
          dirGrid[gridX + shiftXBy + 1] = { 0: ['I', child.path] };
          dirGrid[gridX + shiftXBy + 2] = { '-1': ['C', child.path], 0: ['C', child.path], 1: ['C', child.path] };

          dirIntersections[child.path] = {
            x: gridX + shiftXBy + 1,
            y: 0,
          };

          intersectionOffset += 2 + shiftXBy;
        }
      }

      const maxX = Object.keys(dirGrid).length;
      dirGrid[maxX] = { 0: ['E'] };

      dirGrids[dirPath] = { grid: dirGrid, intersections: dirIntersections };
    }
  }

  return dirGrids;
}

function combineGrids() {
  for (let d = maxDepth; d > 0; d -= 1) {
    const dirs = dirsByDepth[d];

    for (let i = 0; i < dirs.length; i += 1) {
      const childPath = dirs[i];
      const childNode = repoTree[childPath];
      const parentNode = repoTree[childNode.parent_path];
      const parentGrid = dirGrids[parentNode.path];
      console.log(childPath, '=>', parentNode.path);
      const newParentGrid = addChildToParent(childPath, parentGrid);

      parentGrid.grid = newParentGrid;
    }
  }
}

function addChildToParent(childPath, parentGrid, branchDirection: number = 1, fx: null | number = null, fy: null | number = null, shiftLeft = true) {
  const childGrid = dirGrids[childPath];
  const intersection = parentGrid.intersections[childPath];
  const tmpNewParentGrid: any = {};

  const ox = (fx !== null) ? fx : intersection.x;
  const oy = (fy !== null) ? fy : intersection.y + branchDirection;

  let isInvalidOrigin = false;
  let wasInvalidAt: any = {};

  for (const x in parentGrid.grid) {
    tmpNewParentGrid[x] = {};

    for (const y in parentGrid.grid[x]) {
      tmpNewParentGrid[x][y] = parentGrid.grid[x][y].slice();
    }
  }

  for (const x in childGrid.grid) {
    if (!childGrid.grid.hasOwnProperty(x)) {
      continue;
    }

    const ty = oy + (parseInt(x, 10) * branchDirection);

    for (const y in childGrid.grid[x]) {
      if (!childGrid.grid[x].hasOwnProperty(y)) {
        continue;
      }

      const tx = ox - (parseInt(y, 10) * branchDirection);

      const occupied = typeof tmpNewParentGrid[tx] !== 'undefined' && typeof tmpNewParentGrid[tx][ty] !== 'undefined';
      if (occupied) {
        isInvalidOrigin = true;
        wasInvalidAt = { x: tx, y: ty, entity: tmpNewParentGrid[tx][ty] };
        break;
      }

      if (typeof tmpNewParentGrid[tx] === 'undefined') {
        tmpNewParentGrid[tx] = {};
      }

      tmpNewParentGrid[tx][ty] = childGrid.grid[x][y];
    }


    if (isInvalidOrigin) {
      break;
    }
  }

  if (isInvalidOrigin) {
    const newBranchDirection = branchDirection * -1;
    if (newBranchDirection === -1) {
      return addChildToParent(childPath, parentGrid, newBranchDirection, ox, -1, shiftLeft);
    }

    console.log(childPath, '|', isInvalidOrigin, wasInvalidAt, '|', ox, oy, newBranchDirection);
    // return parentGrid.grid;
    const shiftedParentGrid: any = {};
    const shiftedIntersections: any = {};
    const crosswalk = (shiftLeft) ? intersection.x - 1 : intersection.x + 2;

    for (const x in parentGrid.grid) {
      if (!parentGrid.grid.hasOwnProperty(x)) {
        continue;
      }

      const intX = parseInt(x, 10);

      if (intX < crosswalk) {
        shiftedParentGrid[intX] = parentGrid.grid[x];

        if (shiftedParentGrid[intX][0] && shiftedParentGrid[intX][0][0] === 'I') {
          const path = shiftedParentGrid[intX][0][1];
          shiftedIntersections[path] = {
            x: intX,
            y: 0,
          };
        }

        continue
      }

      if (intX === crosswalk) {
        shiftedParentGrid[intX] = { 0: ['R'] };
      }

      const shiftedX = intX + 1;
      // if (!shiftLeft) {
      //   console.log(childPath, crosswalk, '|', intX, shiftedX);
      // }

      shiftedParentGrid[shiftedX] = {};
      for (const y in parentGrid.grid[x]) {
        if (!parentGrid.grid[x].hasOwnProperty(y)) {
          continue;
        }

        const intY = parseInt(y, 10);

        if (Math.abs(intY) > 1) {
          shiftedParentGrid[intX][intY] = parentGrid.grid[x][y];
          continue;
        }

        shiftedParentGrid[shiftedX][intY] = parentGrid.grid[x][y];

        if (shiftedParentGrid[shiftedX][intY][0] === 'I') {
          const path = shiftedParentGrid[shiftedX][intY][1];
          shiftedIntersections[path] = {
            x: shiftedX,
            y: intY,
          };
        }
      }
    }

    const nextX = (shiftLeft) ? ox + 1 : ox;

    return addChildToParent(childPath, { grid: shiftedParentGrid, intersections: shiftedIntersections }, newBranchDirection, nextX, 1, !shiftLeft);
  }

  return tmpNewParentGrid;
}

</script>

<template>
  <div>
    <RenderGrid :grid="rootGrid" />
  </div>
</template>
