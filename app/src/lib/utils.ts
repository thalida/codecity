import { clone, cloneDeep } from 'lodash-es';
import { TILE_TYPE, type TCodeCityGridTile, type TCodeCityTree, type TCodeCityGrid, type TCodeCityGridCombineError, type TCodeCityTreeNode } from './types';


const START_ROAD_SET = [
  [TILE_TYPE.OPEN_SPACE, TILE_TYPE.ROAD_START, TILE_TYPE.OPEN_SPACE],
  [TILE_TYPE.OPEN_SPACE, TILE_TYPE.ROAD, TILE_TYPE.OPEN_SPACE],
]

const END_ROAD_SET = [
  [TILE_TYPE.OPEN_SPACE, TILE_TYPE.ROAD, TILE_TYPE.OPEN_SPACE],
  [TILE_TYPE.OPEN_SPACE, TILE_TYPE.ROAD_END, TILE_TYPE.OPEN_SPACE],
  [TILE_TYPE.OPEN_SPACE, TILE_TYPE.OPEN_SPACE, TILE_TYPE.OPEN_SPACE],
]

const INTERSECTION_SET = [
  TILE_TYPE.ROAD,
  TILE_TYPE.INTERSECTION,
  TILE_TYPE.ROAD,
]

const ROAD_SET = [
  [TILE_TYPE.OPEN_SPACE, TILE_TYPE.ROAD, TILE_TYPE.OPEN_SPACE],
]

const BUILDING_SET = [
  [TILE_TYPE.ROAD, TILE_TYPE.BUILDING, TILE_TYPE.OPEN_SPACE],
  [TILE_TYPE.ROAD, TILE_TYPE.OPEN_SPACE],
]


export function createTile(tileType: TILE_TYPE, nodePath: string, parentPath: null | string = null) {
  const tile: TCodeCityGridTile = {
    tileType,
    nodePath,
    parentPath,
  };

  return tile;
}


export function generateGrid2(repoTree: TCodeCityTree, sourcePath: string, parentPath: null | string = null, maxDepth: null | number = null) {
  if (!(sourcePath in repoTree)) {
    return;
  }

  const sourceNode = repoTree[sourcePath];

  if (maxDepth !== null && sourceNode.depth > maxDepth) {
    return;
  }

  const grid: TCodeCityGrid = {};
  let x = 0;

  for (let i = 0; i < START_ROAD_SET.length; i += 1) {
    for (let j = 0; j < START_ROAD_SET[i].length; j += 1) {
      const newX = x + i;
      const newY = j - 1;
      if (typeof grid[newX] === 'undefined') {
        grid[newX] = {};
      }

      grid[newX][newY] = createTile(START_ROAD_SET[i][j], sourcePath, parentPath);
    }
  }

  x += START_ROAD_SET.length;

  const numChildren = "child_paths" in sourceNode ? sourceNode.child_paths.length : 0;

  for (let childI = 0; childI < numChildren; childI += 1) {
    const childPath = (sourceNode as TCodeCityTreeNode).child_paths[childI];
    const childNode = repoTree[childPath];
    const branchDirection = childI % 2 === 0 ? 1 : -1; // 1 = north, -1 = south

    if (childNode.node_type === 'blob') {
      for (let bi = 0; bi < BUILDING_SET.length; bi += 1) {
        for (let bj = 0; bj < BUILDING_SET[bi].length; bj += 1) {
          const newX = x + bi;
          const newY = bj * branchDirection;
          if (typeof grid[newX] === 'undefined') {
            grid[newX] = {};
          }

          grid[newX][newY] = createTile(BUILDING_SET[bi][bj], childPath, sourcePath);
        }
      }

      x += BUILDING_SET.length;

      continue;
    }

    const childGrid = generateGrid2(repoTree, childPath, sourcePath, maxDepth);
    if (!childGrid) {
      continue;
    }


    const insertX = x;

    let childGridMaxAboveRoad = 0, childGridMinBelowRoad = 0;
    for (const childGridX in childGrid) {
      for (const childGridY in childGrid[childGridX]) {
        const intChildGridY = parseInt(childGridY, 10);

        if (intChildGridY > childGridMaxAboveRoad) {
          childGridMaxAboveRoad = intChildGridY;
        }

        if (intChildGridY < childGridMinBelowRoad) {
          childGridMinBelowRoad = intChildGridY;
        }
      }
    }

    const directionMinX = branchDirection === 1 ? childGridMaxAboveRoad : childGridMinBelowRoad;
    const directionMaxX = branchDirection === 1 ? childGridMinBelowRoad : childGridMaxAboveRoad;

    const fillLeft = Math.abs(directionMinX);
    const fillRight = Math.abs(directionMaxX);

    for (let fillI = 0; fillI < fillLeft; fillI += 1) {
      for (let rI = 0; rI < ROAD_SET.length; rI += 1) {
        for (let rJ = 0; rJ < ROAD_SET[rI].length; rJ += 1) {
          const newX = x + fillI + rI;
          const newY = rJ - 1;
          if (typeof grid[newX] === 'undefined') {
            grid[newX] = {};
          }

          grid[newX][newY] = createTile(ROAD_SET[rI][rJ], childPath, sourcePath);
        }
      }
    }
    x += fillLeft * ROAD_SET.length;

    for (let interI = 0; interI < INTERSECTION_SET.length; interI += 1) {
      const newX = x + interI;
      if (typeof grid[newX] === 'undefined') {
        grid[newX] = {};
      }
      grid[newX][0] = createTile(INTERSECTION_SET[interI], childPath, sourcePath);
    }
    x += INTERSECTION_SET.length;

    for (let fillI = 0; fillI < fillRight; fillI += 1) {
      for (let rI = 0; rI < ROAD_SET.length; rI += 1) {
        for (let rJ = 0; rJ < ROAD_SET[rI].length; rJ += 1) {
          const newX = x + fillI + rI;
          const newY = rJ - 1;
          if (typeof grid[newX] === 'undefined') {
            grid[newX] = {};
          }

          grid[newX][newY] = createTile(ROAD_SET[rI][rJ], childPath, sourcePath);
        }
      }
    }
    x += fillRight * ROAD_SET.length;

    for (const childGridX in childGrid) {
      for (const childGridY in childGrid[childGridX]) {
        const cx = parseInt(childGridX, 10);
        const cy = parseInt(childGridY, 10);

        const newX = insertX + cy + fillLeft + 1;
        const newY = (cx + 1) * branchDirection;

        if (typeof grid[newX] === 'undefined') {
          grid[newX] = {};
        }

        grid[newX][newY] = childGrid[childGridX][childGridY];
      }
    }
  }


  for (let i = 0; i < END_ROAD_SET.length; i += 1) {
    for (let j = 0; j < END_ROAD_SET[i].length; j += 1) {
      const newX = x + i;
      const newY = j - 1;
      if (typeof grid[newX] === 'undefined') {
        grid[newX] = {};
      }

      grid[newX][newY] = createTile(END_ROAD_SET[i][j], sourcePath, parentPath);
    }
  }

  return cloneDeep(grid);
}

export function generateGrid(repoTree: TCodeCityTree, sourcePath: string, parentPath: null | string = null, maxDepth: null | number = null) {
  if (!(sourcePath in repoTree)) {
    return;
  }

  const sourceNode = repoTree[sourcePath];

  if (maxDepth !== null && sourceNode.depth > maxDepth) {
    return;
  }


  const numChildren = "child_paths" in sourceNode ? sourceNode.child_paths.length : 0;

  let grid: TCodeCityGrid = {};

  const endTile = createTile(TILE_TYPE.ROAD_END, sourcePath, parentPath)
  const startTile = createTile(TILE_TYPE.ROAD_START, sourcePath, parentPath);
  const openSpaceTile = createTile(TILE_TYPE.OPEN_SPACE, sourcePath, parentPath);
  const roadTile = createTile(TILE_TYPE.ROAD, sourcePath, parentPath);

  for (let sx = 0; sx <= 1; sx += 1) {
    for (let sy = -1; sy <= 1; sy += 1) {
      if (typeof grid[sx] === 'undefined') {
        grid[sx] = {};
      }

      if (sx === 0 && sy === 0) {
        grid[sx][sy] = startTile;
        continue;
      }

      if (sy === 0) {
        grid[sx][sy] = roadTile;
        continue;
      }

      grid[sx][sy] = openSpaceTile;
    }
  }

  let x = Object.keys(grid).length;

  for (let i = 0; i < numChildren; i += 1) {
    const childPath = (sourceNode as TCodeCityTreeNode).child_paths[i];
    const childNode = repoTree[childPath];

    if (childNode.node_type === 'blob') {
      const by = i % 2 === 0 ? 1 : -1;

      for (let bx = 0; bx <= 1; bx += 1) {
        if (typeof grid[x + bx] === 'undefined') {
          grid[x + bx] = {};
        }

        if (typeof grid[x + bx][0] === 'undefined') {
          grid[x + bx][0] = createTile(TILE_TYPE.ROAD, childPath, sourcePath)
        }

        if (bx === 0) {
          grid[x + bx][by] = createTile(TILE_TYPE.BUILDING, childPath, sourcePath);
          continue;
        }

        grid[x + bx][by] = createTile(TILE_TYPE.OPEN_SPACE, childPath, sourcePath);
      }

      if (by === -1) {
        x += 2;
      }

      continue;
    }

    const childGrid = generateGrid(repoTree, childPath, sourcePath, maxDepth);
    if (childGrid) {
      let foundValidGrid = false;
      let tmpNorthGrid: TCodeCityGrid | TCodeCityGridCombineError = {};
      let tmpSouthGrid: TCodeCityGrid | TCodeCityGridCombineError = {};
      let branchDepth = 1;
      const maxX = Math.abs(Math.min(...Object.keys(childGrid).map((x) => parseInt(x, 10))));
      branchDepth = maxX + 1
      const ix = x;
      let nx = ix, ny = 1 * branchDepth;
      let sx = ix, sy = -1 * branchDepth;
      while (!foundValidGrid) {
        tmpNorthGrid = combineGrids(grid, childGrid, sourcePath, childPath, nx, ny, 1, ix);
        tmpSouthGrid = combineGrids(grid, childGrid, sourcePath, childPath, sx, sy, -1, ix);

        if ("error" in tmpNorthGrid && tmpNorthGrid.error) {
          if (tmpNorthGrid.errorReason.isOverlappingRoad) {
            ny += 1;
          } else {
            nx += 1;
          }
        } else {
          foundValidGrid = true;
        }

        if ("error" in tmpSouthGrid && tmpSouthGrid.error) {
          if (tmpSouthGrid.errorReason.isOverlappingRoad) {
            sy -= 1;
          } else {
            sx += 1;
          }
        } else {
          foundValidGrid = true;
        }
      }

      if (!("error" in tmpNorthGrid) && !("error" in tmpSouthGrid)) {
        grid = i % 2 === 0 ? tmpNorthGrid : tmpSouthGrid;
        x = (i % 2 === 0 ? nx : sx) + 1;
      } else {
        grid = "error" in tmpSouthGrid ? tmpNorthGrid : tmpSouthGrid;
        x = ("error" in tmpSouthGrid ? nx : sx) + 1;
      }
    }
  }

  const maxX = Math.max(...Object.keys(grid).map((x) => parseInt(x, 10))) + 1;

  for (let ix = 0; ix <= 2; ix += 1) {
    for (let iy = -1; iy <= 1; iy += 1) {
      const ex = maxX + ix;

      if (typeof grid[ex] === 'undefined') {
        grid[ex] = {};
      }

      if (ix === 2) {
        grid[ex][iy] = openSpaceTile;
        continue;
      }

      if (ix === 1 && iy === 0) {
        grid[ex][iy] = endTile;
        continue;
      }

      if (iy === 0) {
        grid[ex][iy] = roadTile;
        continue;
      }

      grid[ex][iy] = openSpaceTile;
    }
  }

  return grid;
}

export function combineGrids(
  parentGrid: TCodeCityGrid,
  childGrid: TCodeCityGrid,
  parentPath: string,
  childPath: string,
  ox: number,
  oy: number,
  branchDirection: 1 | -1,
  sx: number
): TCodeCityGrid | TCodeCityGridCombineError {
  const tmpNewParentGrid: TCodeCityGrid = cloneDeep(parentGrid);
  const tmpChildGrid: TCodeCityGrid = {};
  let isInvalidOrigin = false;
  let errorReason: TCodeCityGridCombineError["errorReason"] = {
    isOverlappingRoad: false,
    isOccupied: false,
    tx: 0,
    ty: 0,
  };

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

  // const openSpaceTile = createTile(TILE_TYPE.OPEN_SPACE, childPath, parentPath);
  // const intersectionTile = createTile(TILE_TYPE.INTERSECTION, childPath, parentPath);
  // const roadTile = createTile(TILE_TYPE.ROAD, childPath, parentPath);

  // for (let i = -1; i <= 1; i += 1) {
  //   if (typeof tmpNewParentGrid[ox + i] === 'undefined') {
  //     tmpNewParentGrid[ox + i] = {};
  //   }

  //   if (i === 0) {
  //     tmpNewParentGrid[ox][0] = intersectionTile;
  //     continue;
  //   }

  //   for (let j = -1; j <= 1; j += 1) {
  //     if (j === 0) {
  //       tmpNewParentGrid[ox + i][j] = roadTile;
  //     } else {
  //       tmpNewParentGrid[ox + i][j] = openSpaceTile;
  //     }
  //   }
  // }

  const numExtraChildRoadTiles = Math.abs(oy) - 1;
  for (let i = 0; i < numExtraChildRoadTiles; i += 1) {
    const tile = createTile(i == 0 ? TILE_TYPE.ROAD_START : TILE_TYPE.ROAD, childPath, parentPath);
    tmpChildGrid[i] = { 0: tile };
  }

  for (const x in childGrid) {
    if (!(x in childGrid)) {
      continue;
    }

    const intX = parseInt(x, 10);
    tmpChildGrid[intX + numExtraChildRoadTiles] = {
      ...childGrid[x],
      ...tmpChildGrid[intX + numExtraChildRoadTiles],
    };
  }

  for (const x in tmpChildGrid) {
    if (!(x in tmpChildGrid)) {
      continue;
    }

    const ty = branchDirection + (parseInt(x, 10) * branchDirection);

    for (const y in tmpChildGrid[x]) {
      if (!(y in tmpChildGrid[x])) {
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
