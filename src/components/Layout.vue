<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SystemNav from './SystemNav.vue'

const route = useRoute()
const showNavigation = computed(() => !route.meta.hideNav)
</script>

<template>
  <div class="layout" :class="{ 'without-navigation': !showNavigation }">
    <SystemNav v-if="showNavigation" />
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.layout {
  min-height: 100vh;
  background: #eef3f7;
}

.main-content {
  min-height: calc(100vh - 66px);
  overflow-x: hidden;
}

.without-navigation .main-content {
  min-height: 100vh;
}
</style>
