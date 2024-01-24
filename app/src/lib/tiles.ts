import { Color3, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { TILE_TYPE, type TCodeCityNode, type TCodeCityGridTile } from "./types";

export const renderTileFn = {
  [TILE_TYPE.ROAD_START]: renderRoadStart,
  [TILE_TYPE.ROAD_END]: renderRoadEnd,
  [TILE_TYPE.ROAD]: renderRoad,
  [TILE_TYPE.CROSSWALK]: renderCrosswalk,
  [TILE_TYPE.INTERSECTION]: renderIntersection,
  [TILE_TYPE.BUILDING]: renderBuilding,
}

export function renderRoadStart(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const elem = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  elem.position.x = x
  elem.position.y = height / 2;
  elem.position.z = z

  const material = new StandardMaterial('material', scene);
  const color = node.node_type === 'tree' && node.is_root ? '#ff0000' : '#05b870';
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString(color);
  elem.material = material;
}

export function renderRoadEnd(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const elem = MeshBuilder.CreateBox('box', { height: 0.1, width: 1, depth: 1 }, scene);
  elem.position.x = x
  elem.position.y = height / 2;
  elem.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#4605b8');
  elem.material = material;
}

export function renderRoad(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const elem = MeshBuilder.CreateBox('box', { height: 0.1, width: 1, depth: 1 }, scene);
  elem.position.x = x
  elem.position.y = height / 2;
  elem.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#727272');
  elem.material = material;
}

export function renderCrosswalk(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const elem = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  elem.position.x = x
  elem.position.y = height / 2;
  elem.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#edead9');
  elem.material = material;
}

export function renderIntersection(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const elem = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  elem.position.x = x
  elem.position.y = height / 2;
  elem.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#d7c346');
  elem.material = material;
}

export function renderBuilding(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  if (node.node_type !== 'blob') {
    return;
  }

  const height = node.num_lines ? Math.ceil(Math.log(node.num_lines)) + 2 : 2;
  const elem = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  elem.position.x = x
  elem.position.y = height / 2;
  elem.position.z = z
}
