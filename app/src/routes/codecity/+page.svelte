<script lang="ts">
	import { PUBLIC_API_URL } from '$env/static/public';
	import { onMount } from 'svelte';
	import type { TCodeCityGrid, TCodeCityNode, TCodeCityTree, TCodeCityTreeNode } from '$lib/types';
	import { io } from 'socket.io-client';
	import {
		ArcRotateCamera,
		Engine,
		HemisphericLight,
		Scene,
		Vector3,
		type Nullable
	} from '@babylonjs/core';
	import { renderTileFn } from '$lib/tiles';
	import { generateGrid2 } from '$lib/utils';
	import { debounce, throttle } from 'lodash-es';
	import { clientStore } from '$lib/store';

	const repoTree: TCodeCityTree = {};

	console.log('clientId', $clientStore.uid);
	let engine: Engine;
	let scene: Scene;

	let canvas: HTMLCanvasElement;

	const renderCity = debounce(
		(nodes: TCodeCityTree, grid: TCodeCityGrid | undefined, scene: Scene) => {
			if (!grid) {
				return;
			}

			scene.blockfreeActiveMeshesAndRenderingGroups = true;
			while (scene.meshes.length) {
				const mesh = scene.meshes[0];
				mesh.dispose();
			}
			scene.blockfreeActiveMeshesAndRenderingGroups = false;

			for (const x in grid) {
				for (const y in grid[x]) {
					const tile = grid[x][y];
					const node = nodes[tile.nodePath];
					renderTileFn[tile.tileType](node, tile, scene, parseInt(x), parseInt(y));
				}
			}
		},
		2000,
		{ leading: true, trailing: true }
	);

	const updateCityGrid = throttle(
		(nodes) => {
			const grid = generateGrid2(nodes, '.');
			renderCity(nodes, grid, scene);
		},
		2000,
		{ leading: false, trailing: true }
	);

	function addTreeNode(node: TCodeCityNode) {
		repoTree[node.path] = node;

		if (typeof node.parent_path === 'undefined' || node.parent_path === null) {
			return repoTree;
		}

		const parentNode = repoTree[node.parent_path] as TCodeCityTreeNode;
		if (typeof parentNode === 'undefined') {
			return repoTree;
		}

		parentNode.child_paths = parentNode.child_paths ?? [];
		parentNode.child_paths.push(node.path);
		repoTree[parentNode.path] = parentNode;

		return repoTree;
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
		const urlParams = new URLSearchParams(window.location.search);
		const repo_url = urlParams.get('repo');

		const socket = io(PUBLIC_API_URL);
		socket.on('connect', () => {
			socket.emit('fetch_repo', {
				repo_url: repo_url,
				client_id: socket.id
				// client_id: $clientStore.uid
			});
		});
		socket.on('fetched_node', (data) => {
			console.log('add repo_node', data['node_path']);
			const node = JSON.parse(data['node']);
			addTreeNode(node);
			updateCityGrid(repoTree);
		});

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
	});
</script>

<svelte:head>
	<title>CodeCity</title>
	<meta name="description" content="Svelte demo app" />
</svelte:head>

<section>
	<div class="citywrapper">
		<canvas bind:this={canvas} />
	</div>
	<!-- <CodeCity /> -->
</section>

<style>
	.citywrapper {
		width: 100vw;
		height: 100vh;
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
