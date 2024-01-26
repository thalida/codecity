import { Color3, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { TILE_TYPE, type TCodeCityNode, type TCodeCityGridTile } from "./types";

export const renderTileFn = {
  [TILE_TYPE.ROAD_START]: renderRoadStart,
  [TILE_TYPE.ROAD_END]: renderRoadEnd,
  [TILE_TYPE.ROAD]: renderRoad,
  [TILE_TYPE.CROSSWALK]: renderCrosswalk,
  [TILE_TYPE.INTERSECTION]: renderIntersection,
  [TILE_TYPE.BUILDING]: renderBuilding,
  [TILE_TYPE.OPEN_SPACE]: renderOpenSpace,
}

export function renderRoadStart(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const mesh = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z

  const material = new StandardMaterial('material', scene);
  const color = node.node_type === 'tree' && node.is_root ? '#ff0000' : '#05b870';
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString(color);
  mesh.material = material;
  mesh.freezeWorldMatrix();
}

export function renderRoadEnd(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const mesh = MeshBuilder.CreateBox('box', { height: 0.1, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#4605b8');
  mesh.material = material;
  mesh.freezeWorldMatrix();
}

export function renderRoad(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const mesh = MeshBuilder.CreateBox('box', { height: 0.1, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#000000');
  mesh.material = material;
  mesh.freezeWorldMatrix();
}

export function renderCrosswalk(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const mesh = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#00ff00');
  mesh.material = material;
  mesh.freezeWorldMatrix();
}

export function renderIntersection(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.1;
  const mesh = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 1;
  material.diffuseColor = Color3.FromHexString('#333333');
  mesh.material = material;
  mesh.freezeWorldMatrix();
}

export function renderBuilding(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  if (node.node_type !== 'blob') {
    return;
  }

  const height = node.num_lines ? Math.ceil(Math.log(node.num_lines)) + 2 : 2;
  const mesh = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z
  mesh.freezeWorldMatrix();
}

export function renderOpenSpace(node: TCodeCityNode, tile: TCodeCityGridTile, scene: Scene, x: number, z: number) {
  const height = 0.01;
  const mesh = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
  mesh.position.x = x
  mesh.position.y = height / 2;
  mesh.position.z = z

  const material = new StandardMaterial('material', scene);
  material.alpha = 0.3;
  material.diffuseColor = Color3.FromHexString('#333333');
  mesh.material = material;
  mesh.freezeWorldMatrix();
}
