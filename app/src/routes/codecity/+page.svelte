<script lang="ts">
	import type {
		TCodeCityBlobNode,
		TCodeCityNode,
		TCodeCityTree,
		TCodeCityTreeNode
	} from '$lib/types';
	import type { PageData } from './$types';
	import CodeCity, { trigger, CodeCityEvent } from './CodeCity.svelte';

	export let data: PageData;

	const nodes: TCodeCityTree = {};

	async function handleStream() {
		const stream = await data.repoTreeStream;

		if (!stream) {
			return;
		}

		for await (const node of stream) {
			addNode(node);
			trigger(CodeCityEvent.UPDATE_CITY, nodes);
		}
	}

	function addNode(node: TCodeCityNode) {
		nodes[node.path] = node;

		if (typeof node.parent_path === 'undefined' || node.parent_path === null) {
			return;
		}

		const parentNode = nodes[node.parent_path] as TCodeCityTreeNode;
		parentNode.child_paths = parentNode.child_paths ?? [];
		parentNode.child_paths.push(node.path);
		nodes[parentNode.path] = parentNode;
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
