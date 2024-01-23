import { useEffect, useRef } from "react";
import { Engine, Nullable, Scene } from "@babylonjs/core";

export default function SceneComponent({ antialias, engineOptions, adaptToDeviceRatio, observeCanvasResize, sceneOptions, onRender, onSceneReady, ...rest }: any) {
  const reactCanvas = useRef(null);

  // set up basic engine and scene
  useEffect(() => {
    const { current: canvas } = reactCanvas;

    if (!canvas) return;


    canvas.style.width = "100%";
    canvas.style.height = "100%";

    let resizeObserver: Nullable<ResizeObserver> = null;

    const engine = new Engine(canvas, antialias, engineOptions, adaptToDeviceRatio);
    const scene = new Scene(engine, sceneOptions);

    if (observeCanvasResize !== false && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        engine.resize();
        if (scene.activeCamera /* needed for rendering */) {
          // render to prevent flickering on resize
          if (typeof onRender === 'function') {
            onRender(scene);
          }
          scene.render();
        }
      });
      resizeObserver.observe(canvas);
    }


    if (scene.isReady()) {
      onSceneReady(scene);
    } else {
      scene.onReadyObservable.addOnce((scene) => onSceneReady(scene));
    }

    engine.runRenderLoop(() => {
      if (typeof onRender === "function") onRender(scene);
      scene.render();
    });

    const resize = () => {
      scene.getEngine().resize();
    };

    if (window) {
      window.addEventListener("resize", resize);
    }

    return () => {
      if (resizeObserver !== null) {
        resizeObserver.disconnect();
      }

      if (window) {
        window.removeEventListener("resize", resize);
      }

      scene.getEngine().dispose();
    };
  }, [antialias, engineOptions, adaptToDeviceRatio, sceneOptions, onRender, observeCanvasResize, onSceneReady]);

  return <canvas ref={reactCanvas} {...rest} />;
}
