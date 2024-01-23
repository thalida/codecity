import { Vector3, HemisphericLight, MeshBuilder, ArcRotateCamera } from "@babylonjs/core";
// import SceneComponent from 'babylonjs-hook';
import SceneComponent from "./SceneComponent";
import { CodeCityBlobNode, CodeCityTreeNode } from "~/api/client";
import { generateGrid } from "~/utils";
import { useEffect, useState } from "react";


export default function CodeCityScene({ nodes }: { nodes: Record<string, CodeCityBlobNode | CodeCityTreeNode> }) {
  const [globalScene, setGlobalScene] = useState<any>(null);
  const [grid, setGrid] = useState<any>(null);

  useEffect(() => {
    const g = generateGrid(nodes, ".")
    if (!g) {
      return;
    }

    setGrid(g);
  }, [nodes])

  useEffect(() => {
    if (!grid || !globalScene) {
      return;
    }

    const ys = Object.keys(grid);

    for (let y = 0; y < ys.length; y += 1) {
      const xs = Object.keys(grid[ys[y]]);

      for (let x = 0; x < xs.length; x += 1) {
        // const tile = grid[ys[y]][xs[x]];
        const elem = MeshBuilder.CreateBox("box", { height: 0.2, width: 1, depth: 1 }, globalScene);
        elem.position.x = x;
        elem.position.y = y;
      }
    }
  }, [grid])

  const onSceneReady = (scene) => {
    // https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction#arc-rotate-camera
    const camera = new ArcRotateCamera("ArcRotateCamera", 0, 0, 10, new Vector3(0, 0, 0), scene);
    camera.zoomToMouseLocation = true;
    // camera.wheelDeltaPercentage = 0.01;
    camera.allowUpsideDown = false;
    camera.upperBetaLimit = (Math.PI / 2) - 0.1;
    camera.setPosition(new Vector3(0, 5, -10));

    const canvas = scene.getEngine().getRenderingCanvas();

    // This attaches the camera to the canvas
    camera.attachControl(canvas, false);

    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);

    // Default intensity is 1. Let's dim the light a small amount
    light.intensity = 0.7;

    setGlobalScene(scene);

    // Our built-in 'ground' shape.
    // MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);
  };


  // function renderTreeNode(scene, node: CodeCityTreeNode) {
  //   if (renderedNodes[node.path] !== undefined) {
  //     return;
  //   }

  //   const elem = MeshBuilder.CreateBox("box", { height: 0.2, width: 3, depth: 100 }, scene);
  //   elem.position.x = Math.random() * 10;
  //   elem.position.y = Math.random() * 10;

  //   renderedNodes[node.path] = elem;
  // }

  // function renderBlobNode(scene, node: CodeCityBlobNode) {
  //   // if (renderedNodes[node.path] !== undefined) {
  //   //   return;
  //   // }

  //   // const elem = MeshBuilder.CreateBox("box", { size: 2 }, scene);
  //   // elem.position.x = Math.random() * 10;
  //   // elem.position.y = Math.random() * 10;

  //   // renderedNodes[node.path] = elem;
  // }


  /**
   * Will run on every frame render.  We are spinning the box on y-axis.
   */
  const onRender = (scene) => {

    // const ys = Object.keys(grid);

    // for (let y = 0; y < ys.length; y += 1) {
    //   const xs = Object.keys(grid[ys[y]]);

    //   for (let x = 0; x < xs.length; x += 1) {
    //     const tile = grid[ys[y]][xs[x]];
    //     console.log(x, y, tile);
    //     const elem = MeshBuilder.CreateBox("box", { height: 0.2, width: 1, depth: 1 }, scene);
    //     elem.position.x = y;
    //     elem.position.y = x;
    //   }
    // }


    // const grid = generateGrid(nodes, ".")
    // console.log(grid);
    // for (const node of Object.values(nodes)) {
    //   if (node.node_type === "tree") {
    //     renderTreeNode(scene, node as CodeCityTreeNode);
    //   } else if (node.node_type === "blob") {
    //     renderBlobNode(scene, node as CodeCityBlobNode);
    //   }
    // }
  };

  return (
    <div style={
      {
        width: "100vw",
        height: "100vh",
        position: "absolute",
        overflow: "hidden",
        left: 0,
        top: 0,
      }
    }>
      <SceneComponent
        antialias
        onSceneReady={onSceneReady}
        onRender={onRender}
        observeCanvasResize={true}
        adaptToDeviceRatio={true}
        id="my-canvas" />
    </div>
  );
}
