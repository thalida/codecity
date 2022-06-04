<script setup lang="ts">
import axios from "axios";
import { cloneDeep, parseInt } from "lodash-es";
import RenderGrid from "./RenderGrid.vue";

const props = defineProps(['repoUrl'])
const repoData = await fetchRepo();
const repoTree = repoData.tree;
const repoGrid = generateGrid(repoTree, '.')
console.log(repoTree, repoGrid);

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

function generateGrid(repoTree, sourcePath) {
  const maxDepth = 2;
  const sourceNode = repoTree[sourcePath];

  if (sourceNode.depth > maxDepth) {
    return;
  }

  let grid: any = {};

  grid[0] = { 0: ['S', sourcePath] };

  let x = Object.keys(grid).length;

  for (let i = 0; i < sourceNode.child_paths.length; i += 1) {
    const childPath = sourceNode.child_paths[i];
    const childNode = repoTree[childPath];


    if (childNode.type === 'blob') {
      const by = i % 2 === 0 ? 1 : -1;

      if (typeof grid[x] === 'undefined') {
        grid[x] = {};
      }

      grid[x][0] = ['R'];
      grid[x][by] = ['B', childPath];

      if (by === -1) {
        x += 1;
      }

      continue;
    }

    if (typeof grid[x] !== 'undefined') {
      x += 1;
    }

    // console.log(sourcePath, x - 1, grid[x - 1]);
    // if (grid[x - 1][0][0] === 'C') {
    //   console.log('C', grid[x - 1][0][1]);
    // }

    const childGrid = generateGrid(repoTree, childPath);
    let foundValidGrid = false;
    let tmpNorthGrid: any = {};
    let tmpSouthGrid: any = {};
    const ix = x + 1;
    let nx = ix, ny = 1, sx = ix, sy = -1;
    while (!foundValidGrid) {
      tmpNorthGrid = combineGrids(grid, childGrid, childPath, nx, ny, 1, ix);
      tmpSouthGrid = combineGrids(grid, childGrid, childPath, sx, sy, -1, ix);

      if (tmpNorthGrid.error) {
        if (tmpNorthGrid.errorReason.isOverlappingRoad) {
          ny += 1;
        } else {
          nx += 1;
        }
      } else {
        foundValidGrid = true;
      }

      if (tmpSouthGrid.error) {
        if (tmpSouthGrid.errorReason.isOverlappingRoad) {
          sy -= 1;
        } else {
          sx += 1;
        }
      } else {
        foundValidGrid = true;
      }
    }

    x = (tmpNorthGrid.error ? sx : nx) + 2;
    grid = cloneDeep(tmpNorthGrid.error ? tmpSouthGrid : tmpNorthGrid);
  }


  console.log(grid[x - 1]);
  if (typeof grid[x] === "undefined") {
    grid[x] = { 0: ['E'] };
  } else {
    grid[x + 1] = {
      ...{ 0: ['E'] },
      ...grid[x + 1],
    };
  }

  return grid;
}

function combineGrids(parentGrid, childGrid, childPath, ox, oy, branchDirection, sx) {
  const tmpNewParentGrid: any = cloneDeep(parentGrid);
  const tmpChildGrid: any = {};
  let isInvalidOrigin = false;
  let errorReason = {};

  // const numExtraParentRoadTiles = ox - sx;
  // for (let i = 0; i < numExtraParentRoadTiles; i += 1) {
  //   tmpNewParentGrid[sx + i] = { 0: ['R'] };
  // }

  tmpNewParentGrid[ox - 1] = { '-1': ['C'], 0: ['C'], 1: ['C'] }
  tmpNewParentGrid[ox] = { 0: ['I', childPath] }
  tmpNewParentGrid[ox + 1] = { '-1': ['C'], 0: ['C'], 1: ['C'] }

  const numExtraChildRoadTiles = Math.abs(oy) - 1;
  for (let i = 0; i < numExtraChildRoadTiles; i += 1) {
    tmpChildGrid[i] = { 0: ['R'] };
  }

  for (const x in childGrid) {
    if (!childGrid.hasOwnProperty(x)) {
      continue;
    }

    tmpChildGrid[parseInt(x, 10) + numExtraChildRoadTiles] = {
      ...tmpChildGrid[parseInt(x, 10) + numExtraChildRoadTiles],
      ...childGrid[x]
    };
  }

  for (const x in tmpChildGrid) {
    if (!tmpChildGrid.hasOwnProperty(x)) {
      continue;
    }

    const ty = oy + (parseInt(x, 10) * branchDirection);

    for (const y in tmpChildGrid[x]) {
      if (!tmpChildGrid[x].hasOwnProperty(y)) {
        continue;
      }

      const tx = ox - (parseInt(y, 10) * branchDirection);

      const isOverlappingRoad = (branchDirection === 1 && ty <= 0) || (branchDirection === -1 && ty >= 0)
      const isOccupied = typeof tmpNewParentGrid[tx] !== 'undefined' && typeof tmpNewParentGrid[tx][ty] !== 'undefined';
      const isValid = !isOverlappingRoad && !isOccupied;

      if (!isValid) {
        isInvalidOrigin = true;
        errorReason = { isOverlappingRoad, isOccupied, tx, ty };
        break;
      }

      if (typeof tmpNewParentGrid[tx] === 'undefined') {
        tmpNewParentGrid[tx] = {};
      }

      tmpNewParentGrid[tx][ty] = tmpChildGrid[x][y];
    }


    if (isInvalidOrigin) {
      break;
    }
  }

  if (isInvalidOrigin) {
    return { error: true, errorReason };
  }

  return tmpNewParentGrid;
}

</script>

<template>
  <div>
    <RenderGrid :grid="repoGrid" />
  </div>
</template>
