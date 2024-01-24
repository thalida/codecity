<script lang="ts">
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import type {
		TCodeCityBlobNode,
		TCodeCityNode,
		TCodeCityTree,
		TCodeCityTreeNode
	} from '$lib/types';
	import type { PageData } from './$types';
	import CodeCity from './CodeCity.svelte';

	export let data: PageData;

	export const repoTree = writable<TCodeCityTree>({});

	setContext('repoTree', repoTree);

	async function handleStream() {
		const stream = await data.repoTreeStream;

		if (!stream) {
			return;
		}

		for await (const node of stream) {
			addTreeNode(node);
		}
	}

	function addTreeNode(node: TCodeCityNode) {
		repoTree.update((repoTree) => {
			repoTree[node.path] = node;

			if (typeof node.parent_path === 'undefined' || node.parent_path === null) {
				return repoTree;
			}

			const parentNode = repoTree[node.parent_path] as TCodeCityTreeNode;
			parentNode.child_paths = parentNode.child_paths ?? [];
			parentNode.child_paths.push(node.path);
			repoTree[parentNode.path] = parentNode;

			return repoTree;
		});
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
