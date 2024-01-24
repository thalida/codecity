<script lang="ts" context="module">
	export enum CodeCityEvent {
		UPDATE_CITY = 'updateAndRenderCity'
	}

	let moduleEvents: Record<CodeCityEvent, any> = {
		[CodeCityEvent.UPDATE_CITY]: () => {}
	};

	export function trigger(event: CodeCityEvent, data: any) {
		moduleEvents[event](data);
	}
</script>

<script lang="ts">
	import {
		Engine,
		type Nullable,
		Scene,
		ArcRotateCamera,
		Vector3,
		HemisphericLight,
		MeshBuilder
	} from '@babylonjs/core';
	import type {
		TCodeCityBlobNode,
		TCodeCityNode,
		TCodeCityTree,
		TCodeCityTreeNode
	} from '$lib/types';
	import { onMount } from 'svelte';
	import { generateGrid } from '$lib/utils';
	import { cloneDeep } from 'lodash-es';

	let nodes: TCodeCityTree = {};
	let grid: any;
	let engine: Engine;
	let scene: Scene;

	let canvas: HTMLCanvasElement;

	function onUpdateCity(payload: TCodeCityTree) {
		nodes = cloneDeep(payload);
		grid = generateGrid(nodes, '.');
		renderCity(scene);
	}

	moduleEvents[CodeCityEvent.UPDATE_CITY] = onUpdateCity;

	function renderCity(scene: Scene) {
		if (!grid) {
			return;
		}

		for (const x in grid) {
			for (const y in grid[x]) {
				const tile = grid[x][y];
				const node = nodes[tile.nodePath];
				const height = node.node_type === 'blob' ? 1 : 0.1;
				const elem = MeshBuilder.CreateBox('box', { height, width: 1, depth: 1 }, scene);
				elem.position.x = parseInt(x, 10);
				elem.position.y = height / 2;
				elem.position.z = parseInt(y, 10);
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

		renderCity(scene);
	}

	function onRender(scene: Scene) {}

	onMount(() => {
		canvas.style.width = '100%';
		canvas.style.height = '100%';

		let resizeObserver: Nullable<ResizeObserver> = null;

		engine = new Engine(canvas, true, {}, true);
		scene = new Scene(engine, {});

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
