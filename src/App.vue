<script>
import Layout from './components/Layout.vue'

export default {
  name: 'App',
  components: {
    Layout
  }
}
</script>

<template>
  <Layout />
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 16px;
}

body {
  min-width: 320px;
  color: #1b2f41;
  background: #eef3f7;
  font-family:
    "Microsoft YaHei",
    "PingFang SC",
    "Noto Sans CJK SC",
    Arial,
    sans-serif;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}

button,
input,
select,
textarea {
  font: inherit;
}
</style>
