<!--
  The same city, in Vue. Nothing below is codecity-specific plumbing: it is a
  ref, a watch and a dispose, which is what a framework adapter for a package
  like this one should cost.

  The point of this file is what is NOT in it. There is no store, no event
  reducer, no status enum of its own, and no reimplementation of anything in
  packages/app. If a Vue consumer needed one of those, this file could not be
  this short — which is why it is the plan's measure.
-->
<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
import { createCity, CityLifecycle } from '@codecity/city';

const props = defineProps({
  src: { type: String, required: true },
  baseUrl: { type: String, default: '/api' },
});

const canvas = ref(null);
// shallowRef, not ref: a city holds a THREE scene, and deep reactivity over a
// scene graph is a lot of proxy for no benefit.
const city = shallowRef(null);
const status = ref({ lifecycle: CityLifecycle.Empty, fetching: false, phase: null, fraction: null });
const selection = shallowRef(null);

onMounted(async () => {
  const instance = await createCity(canvas.value, { baseUrl: props.baseUrl });
  city.value = instance;

  // One value in, one value out. `status` is readable immediately, so the
  // first render is correct before any event has arrived.
  status.value = instance.status;
  instance.onChange((change, ctx) => {
    if (change.statusChanged) status.value = ctx.status;
    if (change.selectionChanged) selection.value = ctx.selection;
  });

  await instance.loadSource({ src: props.src });
});

onBeforeUnmount(() => city.value?.dispose());

defineExpose({
  // The imperative handle, the way Excalidraw exposes excalidrawAPI: a parent
  // that wants to drive the city gets the city, not a wrapper over it.
  city,
  getViewState: () => city.value?.getViewState() ?? null,
  setViewState: (view) => city.value?.setViewState(view),
});
</script>

<template>
  <div class="codecity">
    <canvas ref="canvas" class="codecity__canvas" />
    <div class="codecity__readout">
      <span v-if="status.lifecycle === 'error'">could not load</span>
      <span v-else-if="status.phase">{{ status.phase }}</span>
      <span v-else-if="status.fetching">still loading history</span>
      <span v-else>ready</span>
      <progress v-if="status.fraction !== null" :value="status.fraction" max="1" />
    </div>
    <slot name="selection" :selection="selection" />
  </div>
</template>

<style scoped>
.codecity {
  position: relative;
  height: 100%;
}
.codecity__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.codecity__readout {
  position: absolute;
  inset: auto auto 12px 12px;
  font: 13px ui-sans-serif, system-ui, sans-serif;
  color: #f4f6ff;
}
</style>
