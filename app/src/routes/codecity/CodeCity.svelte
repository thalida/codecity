<script lang="ts">
	import type { Writable } from 'svelte/store';
	import {
		Engine,
		type Nullable,
		Scene,
		ArcRotateCamera,
		Vector3,
		HemisphericLight
	} from '@babylonjs/core';
	import { type TCodeCityGrid, type TCodeCityTree } from '$lib/types';
	import { getContext, onMount } from 'svelte';
	import { generateGrid2 } from '$lib/utils';
	import { renderTileFn } from '$lib/tiles';
	import { debounce, throttle } from 'lodash-es';

	let repoTree = getContext<Writable<TCodeCityTree>>('repoTree');
	let engine: Engine;
	let scene: Scene;

	let canvas: HTMLCanvasElement;

	function renderCity(nodes: TCodeCityTree, grid: TCodeCityGrid | undefined, scene: Scene) {
		if (!grid) {
			return;
		}

		for (const x in grid) {
			for (const y in grid[x]) {
				const tile = grid[x][y];
				const node = nodes[tile.nodePath];
				renderTileFn[tile.tileType](node, tile, scene, parseInt(x), parseInt(y));
			}
		}
	}

	function onSceneReady(scene: Scene) {
		// https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction#arc-rotate-camera
		const camera = new ArcRotateCamera('ArcRotateCamera', 0, 0, 10, new Vector3(0, 0, 0), scene);
		camera.zoomToMouseLocation = true;
		// camera.wheelDeltaPercentage = 0.01;
		camera.allowUpsideDown = false;
		camera.upperBetaLimit = Math.PI / 2 - 0.1;
		camera.setPosition(new Vector3(0, 5, -10));

		const canvas = scene.getEngine().getRenderingCanvas();

		camera.attachControl(canvas, false);

		// This creates a light, aiming 0,1,0 - to the sky (non-mesh)
		const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);

		// Default intensity is 1. Let's dim the light a small amount
		light.intensity = 0.7;

		// Our built-in 'ground' shape.
		// MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);

		// renderCity(scene);
	}

	function onRender(scene: Scene) {}

	onMount(() => {
		canvas.style.width = '100%';
		canvas.style.height = '100%';

		let resizeObserver: Nullable<ResizeObserver> = null;

		engine = new Engine(canvas, true, {}, true);
		scene = new Scene(engine, {});
		scene.skipPointerMovePicking = true;
		scene.freezeActiveMeshes();
		scene.autoClear = false; // Color buffer
		scene.autoClearDepthAndStencil = false; // Depth and stencil, obviously

		if (window.ResizeObserver) {
			resizeObserver = new ResizeObserver(() => {
				engine.resize();
				if (scene.activeCamera) {
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
			if (typeof onRender === 'function') onRender(scene);
			scene.render();
		});

		const resize = () => {
			scene.getEngine().resize();
		};

		if (window) {
			window.addEventListener('resize', resize);
		}

		const debouncedCallback = throttle(
			(nodes) => {
				scene.blockfreeActiveMeshesAndRenderingGroups = true;
				while (scene.meshes.length) {
					const mesh = scene.meshes[0];
					mesh.dispose();
				}
				scene.blockfreeActiveMeshesAndRenderingGroups = false;

				const grid = generateGrid2(nodes, '.');
				renderCity(nodes, grid, scene);
			},
			2000,
			{ leading: false, trailing: true }
		);
		repoTree.subscribe(debouncedCallback);
	});
</script>

<div class="citywrapper">
	<canvas bind:this={canvas} />
</div>

<style>
	.citywrapper {
		width: 100vw;
		height: 100vh;
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
