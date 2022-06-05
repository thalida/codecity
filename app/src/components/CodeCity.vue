<script setup lang="ts">
import axios from "axios";
import { cloneDeep, parseInt } from "lodash-es";
import RenderGrid from "./RenderGrid.vue";

const props = defineProps(['repoUrl'])
const repoData = await fetchRepo();
const repoTree = repoData.tree;
const repoGrid = generateGrid(repoTree, '.')
// console.log(repoTree, repoGrid);

async function fetchRepo() {
  const loc = window.location;
  const res = await axios.get(`http://${loc.hostname}:8000/api/repo`, {
    params: {
      url: props.repoUrl,
    },
  });

  return res.data;
}

function generateGrid(repoTree, sourcePath, parentPath = '') {
  // const maxDepth = 4;
  const maxDepth = null;
  const sourceNode = repoTree[sourcePath];

  if (maxDepth && sourceNode.depth > maxDepth) {
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

      if (typeof grid[x][0] === 'undefined') {
        grid[x][0] = ['R', sourcePath];
      }

      grid[x][by] = ['B', sourcePath, childPath];


      if (by === -1) {
        x += 1;
      }

      continue;
    }

    if (grid[x] && grid[x][0]) {
      x += 1;
    }

    if (grid[x - 1] && grid[x - 1][0] && grid[x - 1][0][0] === 'C') {
      if (typeof grid[x] === 'undefined') {
        grid[x] = {};
      }

      grid[x][0] = ['RR', sourcePath, childPath];
      x += 1;
    }

    const childGrid = generateGrid(repoTree, childPath, sourcePath);
    let foundValidGrid = false;
    let tmpNorthGrid: any = {};
    let tmpSouthGrid: any = {};
    const ix = x + 1;
    const height = childGrid ? Math.abs(Math.min(...Object.keys(childGrid).map(Number))) + 1 : 1;
    let nx = ix, ny = 1 * height, sx = ix, sy = -1 * height;
    while (!foundValidGrid) {
      tmpNorthGrid = combineGrids(grid, childGrid, sourcePath, childPath, nx, ny, 1, ix);
      tmpSouthGrid = combineGrids(grid, childGrid, sourcePath, childPath, sx, sy, -1, ix);
      // console.log(tmpNorthGrid.errorReason, tmpSouthGrid.errorReason);
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
    grid = tmpNorthGrid.error ? tmpSouthGrid : tmpNorthGrid;
  }

  const endTile = ['E', sourcePath];
  if (typeof grid[x] === "undefined") {
    grid[x] = { 0: endTile };
  } else if (grid[x] && grid[x][0]) {
    grid[x + 1] = {
      ...{ 0: endTile },
      ...grid[x + 1],
    }
  } else {
    grid[x] = {
      ...{ 0: endTile },
      ...grid[x],
    };
  }

  return grid;
}

function combineGrids(parentGrid, childGrid, parentPath, childPath, ox, oy, branchDirection, sx) {
  const tmpNewParentGrid: any = cloneDeep(parentGrid);
  const tmpChildGrid: any = {};
  let isInvalidOrigin = false;
  let errorReason = {};

  let numExtraParentRoadTiles = ox - sx;
  if (numExtraParentRoadTiles > 0) {
    numExtraParentRoadTiles += 1;
  }

  for (let i = 0; i < numExtraParentRoadTiles; i += 1) {
    tmpNewParentGrid[sx + i - 2] = {
      ...{ 0: ['R'] },
      ...tmpNewParentGrid[sx + i - 2],
    };
  }

  const crosswalkTile = ['C', parentPath, childPath];
  tmpNewParentGrid[ox - 1] = {
    ...{ '-1': crosswalkTile, 0: crosswalkTile, 1: crosswalkTile },
    ...tmpNewParentGrid[ox - 1],
  }
  tmpNewParentGrid[ox] = {
    ...{ 0: ['I', parentPath, childPath] },
    ...tmpNewParentGrid[ox],
  }
  tmpNewParentGrid[ox + 1] = {
    ...{ '-1': crosswalkTile, 0: crosswalkTile, 1: crosswalkTile },
    ...tmpNewParentGrid[ox + 1],
  }


  const numExtraChildRoadTiles = Math.abs(oy) - 1;
  for (let i = 0; i < numExtraChildRoadTiles; i += 1) {
    tmpChildGrid[i] = { 0: [i == 0 ? 'S' : 'R', childPath] };
  }

  for (const x in childGrid) {
    if (!childGrid.hasOwnProperty(x)) {
      continue;
    }

    const intX = parseInt(x, 10);
    tmpChildGrid[intX + numExtraChildRoadTiles] = {
      ...childGrid[x],
      ...tmpChildGrid[intX + numExtraChildRoadTiles],
    };
  }

  for (const x in tmpChildGrid) {
    if (!tmpChildGrid.hasOwnProperty(x)) {
      continue;
    }

    const ty = branchDirection + (parseInt(x, 10) * branchDirection);

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
