<script setup lang="ts">
import axios from "axios";
import { cloneDeep } from "lodash-es";
import RenderGrid from "./RenderGrid.vue";

const props = defineProps(['repoUrl'])
const repoData = await fetchRepo();
const repoTree = repoData.tree;
const repoGrid = generateGrid(repoTree, '.')
console.log(repoTree);

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
  const sourceNode = repoTree[sourcePath];
  let grid: any = {};

  grid[0] = { 0: ['S', sourcePath] };

  let x = Object.keys(grid).length;

  for (let i = 0; i < sourceNode.child_paths; i += 1) {
    const childPath = sourceNode.child_paths[i];
    const childNode = repoTree[childPath];


    if (childNode.type === 'blob') {
      const by = i % 2 === 0 ? 1 : -1;

      grid[x][0] = ['R'];
      grid[x][by] = ['B', childPath];

      if (by === -1) {
        x += 1;
      }

      continue;
    }

    const childGrid = generateGrid(repoTree, childPath);
    const tmpGrid = combineGrids(grid, childGrid, 0, 1, 1);
    console.log(tmpGrid);
  }

  return grid;
}


function combineGrids(parentGrid, childGrid, ox, oy, branchDirection) {
  const tmpNewParentGrid = cloneDeep(parentGrid);
  let isInvalidOrigin = false;

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
    return null;
  }

  return tmpNewParentGrid;
}

</script>

<template>
  <div>
    <!-- <RenderGrid :grid="rootGrid" /> -->
  </div>
</template>
