<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const container = ref(null)

let scene
let camera
let renderer
let controls
let animationFrame
let resizeObserver
const meshMap = new Map()
const originalColors = new Map()

function resize() {
  if (!container.value || !renderer || !camera) return

  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

function resetHighlight() {
  for (const [name, mesh] of meshMap) {
    mesh.material.color.setHex(originalColors.get(name) ?? 0xffffff)
  }
}

function highlightNodes(nodeNames, color = 0xff5a5f) {
  resetHighlight()
  const highlight = new THREE.Color(color)

  for (const nodeName of nodeNames ?? []) {
    const mesh = meshMap.get(nodeName)
    if (mesh) mesh.material.color.copy(highlight)
  }
}

defineExpose({ highlightNodes, resetHighlight })

onMounted(async () => {
  const host = container.value
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#f5f8fa')

  camera = new THREE.PerspectiveCamera(
    32,
    host.clientWidth / Math.max(host.clientHeight, 1),
    1,
    4000
  )
  camera.position.set(360, 90, 0)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(host.clientWidth, host.clientHeight, false)
  host.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 2.1))
  const light = new THREE.DirectionalLight(0xffffff, 2.4)
  light.position.set(280, 220, 180)
  scene.add(light)

  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync('/model/pelvicTest.gltf')
  gltf.scene.scale.setScalar(0.9)

  gltf.scene.traverse((node) => {
    if (!node.isMesh) return

    node.material = node.material.clone()
    meshMap.set(node.name, node)
    originalColors.set(node.name, node.material.color.getHex())
  })

  scene.add(gltf.scene)
  camera.lookAt(0, 0, 0)

  const animate = () => {
    controls?.update()
    renderer?.render(scene, camera)
    animationFrame = requestAnimationFrame(animate)
  }
  animate()

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  controls?.dispose()

  scene?.traverse((node) => {
    node.geometry?.dispose()
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material.dispose())
    } else {
      node.material?.dispose()
    }
  })

  renderer?.dispose()
  renderer?.domElement?.remove()
})
</script>

<template>
  <div ref="container" class="pelvic-model"></div>
</template>

<style scoped>
.pelvic-model {
  width: 100%;
  min-height: 520px;
  height: 100%;
  overflow: hidden;
  border-radius: 18px;
  background: #f5f8fa;
}
</style>
