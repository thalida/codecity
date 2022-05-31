<template>
  <div class="home">
    <CodeCity v-if="hasRepoUrl" :repo-url="repoUrl" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import CodeCity from "@/components/CodeCity/CodeCity.vue"; // @ is an alias to /src

export default defineComponent({
  name: "Home",
  components: {
    CodeCity,
  },
  data: () => ({
    repoUrl: "",
  }),
  created() {
    this.repoUrl = this.$route.query.repo_url as string;
    console.log(this.repoUrl);
  },
  computed: {
    hasRepoUrl() {
      return typeof this.repoUrl !== "undefined";
    },
  },
});
</script>
