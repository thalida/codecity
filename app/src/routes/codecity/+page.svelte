<script lang="ts">
	import type { TCodeCityBlobNode, TCodeCityTreeNode } from '$lib/types';
	import type { PageData } from './$types';

	export let data: PageData;

	const nodes: Record<string, TCodeCityBlobNode | TCodeCityTreeNode> = {};

	async function handleStream() {
		const stream = await data.repoTreeStream;

		if (!stream) {
			return;
		}

		for await (const node of stream) {
			addNode(node);
		}
	}

	function addNode(node: TCodeCityBlobNode | TCodeCityTreeNode) {
		nodes[node.path] = node;

		if (
			typeof node.ancestor_paths === 'undefined' ||
			node.ancestor_paths === null ||
			node.ancestor_paths.length === 0
		) {
			return;
		}

		for (let i = 0; i < node.ancestor_paths.length; i += 1) {
			const ancestorPath = node.ancestor_paths[i];
			const ancestorNode = nodes[ancestorPath] as TCodeCityTreeNode;

			if (!ancestorNode) {
				continue;
			}

			ancestorNode.child_paths = ancestorNode.child_paths ?? [];
			ancestorNode.child_paths.push(node.path);

			nodes[ancestorNode.path] = ancestorNode;
		}
	}

	handleStream();
</script>

<svelte:head>
	<title>CodeCity</title>
	<meta name="description" content="Svelte demo app" />
</svelte:head>

<section></section>

<style>
</style>
