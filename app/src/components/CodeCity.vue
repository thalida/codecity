<script setup lang="ts">
import { TILE_TYPE } from "@/constants/tiles";
import axios from "axios";
import { cloneDeep, parseInt } from "lodash-es";
import RenderGrid from "./RenderGrid.vue";

const props = defineProps(['repoUrl'])
const repoData = await fetchRepo();
const repoTree = repoData.tree;
const repoGrid = generateGrid(repoTree, '.')
console.log(repoTree, repoGrid);

async function fetchRepo() {
  const loc = window.location;
  const res = await axios.get(`http://${loc.hostname}:8000/api/repo`, {
    params: {
      url: props.repoUrl,
    },
  });

  return res.data;
}

function createTile(type: TILE_TYPE, nodePath: string, parentPath: null | string = null) {
  const tile = {
    type,
    nodePath,
    parentPath,
  };

  return tile;
}

function generateGrid(repoTree, sourcePath: string, parentPath: null | string = null, maxDepth: null | number = null) {
  const sourceNode = repoTree[sourcePath];

  if (maxDepth && sourceNode.depth > maxDepth) {
    return;
  }

  const numChildren = sourceNode.child_paths.length;

  let grid: any = {};
  grid[0] = { 0: createTile(TILE_TYPE.DIR_START, sourcePath, parentPath) };

  let x = Object.keys(grid).length;

  for (let i = 0; i < numChildren; i += 1) {
    const childPath = sourceNode.child_paths[i];
    const childNode = repoTree[childPath];

    if (childNode.type === 'blob') {
      const by = i % 2 === 0 ? 1 : -1;

      if (typeof grid[x] === 'undefined') {
        grid[x] = {};
      }

      if (typeof grid[x][0] === 'undefined') {
        grid[x][0] = createTile(TILE_TYPE.ROAD, sourcePath, parentPath)
      }

      grid[x][by] = createTile(TILE_TYPE.BUIlDING, sourcePath, parentPath)


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

      grid[x][0] = createTile(TILE_TYPE.ROAD, sourcePath, parentPath)
      x += 1;
    }

    const childGrid = generateGrid(repoTree, childPath, sourcePath, maxDepth);
    let foundValidGrid = false;
    let tmpNorthGrid: any = {};
    let tmpSouthGrid: any = {};
    let height = 1;
    if (childGrid) {
      const maxX = Math.abs(Math.min(...Object.keys(childGrid).map(Number)));
      height = maxX + 1
    }
    const ix = x + 1;
    let nx = ix, ny = 1 * height, sx = ix, sy = -1 * height;
    while (!foundValidGrid) {
      tmpNorthGrid = combineGrids(grid, childGrid, sourcePath, childPath, nx, ny, 1, ix);
      tmpSouthGrid = combineGrids(grid, childGrid, sourcePath, childPath, sx, sy, -1, ix);

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

    if (typeof tmpNorthGrid.error === 'undefined' && typeof tmpSouthGrid.error === 'undefined') {
      grid = i % 2 === 0 ? tmpNorthGrid : tmpSouthGrid;
      x = (i % 2 === 0 ? nx : sx) + 2;
    } else {
      grid = tmpSouthGrid.error ? tmpNorthGrid : tmpSouthGrid;
      x = (tmpSouthGrid.error ? nx : sx) + 2;
    }
  }

  const endTile = createTile(TILE_TYPE.DIR_END, sourcePath, parentPath)
  if (typeof grid[x] === "undefined") {
    grid[x] = { 0: endTile };
  } else if (grid[x] && grid[x][0]) {
    grid[x + 1] = grid[x + 1] || {};
    grid[x + 1][0] = endTile
  } else {
    grid[x] = grid[x] || {};
    grid[x][0] = endTile
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
    if (typeof tmpNewParentGrid[sx + i - 1] === 'undefined') {
      tmpNewParentGrid[sx + i - 1] = {};
    }

    tmpNewParentGrid[sx + i - 1][0] = createTile(TILE_TYPE.ROAD, parentPath)
  }

  const crosswalkTile = createTile(TILE_TYPE.CROSSWALK, childPath, parentPath);
  const intersectionTile = createTile(TILE_TYPE.INTERSECTION, childPath, parentPath);

  for (let i = -1; i <= 1; i += 1) {
    if (typeof tmpNewParentGrid[ox + i] === 'undefined') {
      tmpNewParentGrid[ox + i] = {};
    }

    if (i === 0) {
      tmpNewParentGrid[ox + i][0] = intersectionTile;
      continue;
    }

    for (let j = -1; j <= 1; j += 1) {
      tmpNewParentGrid[ox + i][j] = crosswalkTile;
    }
  }


  const numExtraChildRoadTiles = Math.abs(oy) - 1;
  for (let i = 0; i < numExtraChildRoadTiles; i += 1) {
    const tile = createTile(i == 0 ? TILE_TYPE.DIR_START : TILE_TYPE.ROAD, childPath, parentPath);
    tmpChildGrid[i] = { 0: tile };
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
