<template>
  <div class="home">
    <CodeCity />
  </div>
</template>

<script>
// @ is an alias to /src
import CodeCity from "@/components/CodeCity.vue";

export default {
  name: "Home",
  components: {
    CodeCity,
  },
};
</script>
