<script lang="ts">
	import type { TCodeCityBlobNode, TCodeCityTreeNode } from '$lib/types';
	import type { PageData } from './$types';
	import CodeCity, { updateTree } from './CodeCity.svelte';

	export let data: PageData;

	const nodes: Record<string, TCodeCityBlobNode | TCodeCityTreeNode> = {};

	async function handleStream() {
		const stream = await data.repoTreeStream;
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		reader.read().then(function pump({ done, value }) {
			if (done) {
				// Do something with last chunk of data then exit reader
				return;
			}
			// Otherwise do something here to process current chunk

			const decodedChunk = decoder.decode(value, { stream: true });

			try {
				const node = JSON.parse(decodedChunk) as TCodeCityBlobNode | TCodeCityTreeNode;
				addNode(node);
				updateTree(nodes);
			} catch (e) {
				console.error(e);
				console.error(decodedChunk);
			}

			// Read some more, and call this function again
			return reader.read().then(pump);
		});

		// console.log(data.repoTreeStream);
		// if (!data.repoTreeStream) {
		// 	return;
		// }

		// const stream = await data.repoTreeStream;

		// if (!stream) {
		// 	return;
		// }

		// for await (const chunk of stream) {
		// 	try {
		// 		const node = JSON.parse(chunk) as TCodeCityBlobNode | TCodeCityTreeNode;
		// 		addNode(node);
		// 		updateTree(nodes);
		// 	} catch (e) {
		// 		console.error(e);
		// 		console.error(chunk);
		// 	}
		// }
	}

	function addNode(node: TCodeCityBlobNode | TCodeCityTreeNode) {
		nodes[node.path] = node;

		if (typeof node.parent_path === 'undefined' || node.parent_path === null) {
			return;
		}

		const parentNode = nodes[node.parent_path] as TCodeCityTreeNode;
		parentNode.child_paths = parentNode.child_paths ?? [];
		parentNode.child_paths.push(node.path);
		nodes[parentNode.path] = parentNode;

		// if (
		// 	typeof node.ancestor_paths === 'undefined' ||
		// 	node.ancestor_paths === null ||
		// 	node.ancestor_paths.length === 0
		// ) {
		// 	return;
		// }

		// for (let i = 0; i < node.ancestor_paths.length; i += 1) {
		// 	const ancestorPath = node.ancestor_paths[i];
		// 	const ancestorNode = nodes[ancestorPath] as TCodeCityTreeNode;

		// 	if (!ancestorNode) {
		// 		continue;
		// 	}

		// 	if (ancestorNode.path !== node.parent_path) {
		// 		continue;
		// 	}

		// 	ancestorNode.child_paths = ancestorNode.child_paths ?? [];
		// 	ancestorNode.child_paths.push(node.path);

		// 	nodes[ancestorNode.path] = ancestorNode;
		// }
	}

	handleStream();
</script>

<svelte:head>
	<title>CodeCity</title>
	<meta name="description" content="Svelte demo app" />
</svelte:head>

<section>
	<CodeCity />
</section>

<style>
</style>
