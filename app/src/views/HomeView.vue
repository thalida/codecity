<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed, ref } from 'vue';
import CodeCity from "@/components/CodeCity.vue";

const route = useRoute()
const repoUrl = ref(route.query.repo as string);
const hasRepoUrl = computed(() => {
  return typeof repoUrl !== "undefined"
})
</script>

<template>
  <main>
    <Suspense>
      <CodeCity v-if="hasRepoUrl" :repo-url="repoUrl" />

      <!-- loading state via #fallback slot -->
      <template #fallback>
        Loading...
      </template>
    </Suspense>
  </main>
</template>
