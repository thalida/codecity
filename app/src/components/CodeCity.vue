<script setup lang="ts">
import groupBy from "lodash-es/groupBy";
import filter from "lodash-es/filter";
import axios from "axios";
import { forEach } from "lodash-es";
// import RenderRepo from "./RenderRepo.vue";

const props = defineProps(['repoUrl'])
const repoData = await fetchRepo();
const repoTree = repoData.tree;
const dirsByDepth = getDirsByDepth(repoTree);
const maxDepth = Object.keys(dirsByDepth).length - 1;
const dirRoads = getDirGrids(repoTree, dirsByDepth, maxDepth);
// doThis();

console.log(repoTree, dirsByDepth, dirRoads);

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
  const dirRoads: any = {};
  for (let d = maxDepth; d >= 0; d -= 1) {
    const dirs = dirsByDepth[d];
    const numDirs = dirs.length;

    for (let i = 0; i < numDirs; i += 1) {
      const dirPath = dirs[i];
      const dir = repoTree[dirPath];
      const dirGrid: any = {};


      dirGrid[0] = { 0: ['C'] };

      let intersectionOffset = 1;
      for (let j = 0; j < dir.tree_stats.num_children; j += 1) {
        const child = repoTree[dir.child_paths[j]];
        const gridX = Math.floor(j / 2) + intersectionOffset;
        const gridY = j % 2 === 0 ? 1 : -1;

        if (child.type === "blob") {
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

          dirGrid[gridX + shiftXBy] = { 0: ['C'] };
          dirGrid[gridX + shiftXBy + 1] = { 0: ['I', child.path] };
          dirGrid[gridX + shiftXBy + 2] = { 0: ['C'] };

          intersectionOffset += 2 + shiftXBy;
        }
      }

      dirRoads[dirPath] = dirGrid;
    }
  }

  return dirRoads;
}

// function doThis() {
//   for (let d = maxDepth; d >= 0; d -= 1) {
//     const dirs = dirsByDepth[d];

//     for (let i = 0; i < dirs.length; i += 1) {
//       const dirPath = dirs[i];
//       const childNode = repoTree[dirPath];
//       const parentNode = repoTree[childNode.parent_path];

//       const childGrid: any = {};
//       const parentGrid: any = {};
//     }
//   }
// }

</script>

<template>
  <div>
    <!-- <RenderRepo :repo="repoCity" /> -->
  </div>
</template>
