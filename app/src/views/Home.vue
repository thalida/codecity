<template>
  <div class="home">
    <CodeCity />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import CodeCity from "@/components/CodeCity.vue"; // @ is an alias to /src

export default defineComponent({
  name: "Home",
  components: {
    CodeCity,
  },
});
</script>
