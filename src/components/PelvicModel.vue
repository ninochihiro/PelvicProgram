<script setup>
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const props = defineProps({
  annotation: {
    type: Object,
    default: null
  },
  focusNodes: {
    type: Array,
    default: () => []
  }
})

const container = ref(null)
const annotationCard = ref(null)
const annotationLayout = ref(null)

let scene
let camera
let renderer
let controls
let animationFrame
let resizeObserver
let annotationFrame
let modelReady = false
const meshMap = new Map()
const originalColors = new Map()
const originalEmissiveColors = new Map()
const originalEmissiveIntensity = new Map()

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function updateAnnotationPosition() {
  cancelAnimationFrame(annotationFrame)
  annotationFrame = requestAnimationFrame(() => {
    const host = container.value
    if (
      !host ||
      !camera ||
      !props.annotation ||
      !props.focusNodes.length
    ) {
      annotationLayout.value = null
      return
    }

    const bounds = new THREE.Box3()
    let hasBounds = false

    for (const nodeName of props.focusNodes) {
      const mesh = meshMap.get(nodeName)
      if (!mesh) continue
      mesh.updateWorldMatrix(true, false)
      const nodeBounds = new THREE.Box3().setFromObject(mesh)
      if (nodeBounds.isEmpty()) continue
      if (hasBounds) {
        bounds.union(nodeBounds)
      } else {
        bounds.copy(nodeBounds)
        hasBounds = true
      }
    }

    if (!hasBounds) {
      annotationLayout.value = null
      return
    }

    const worldCenter = bounds.getCenter(new THREE.Vector3())
    const projected = worldCenter.clone().project(camera)
    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      projected.z < -1 ||
      projected.z > 1
    ) {
      annotationLayout.value = null
      return
    }

    const width = host.clientWidth
    const height = host.clientHeight
    const pointX = (projected.x * 0.5 + 0.5) * width
    const pointY = (-projected.y * 0.5 + 0.5) * height
    const cardWidth = Math.min(310, Math.max(230, width * 0.36))
    const cardHeight = annotationCard.value?.offsetHeight ?? 160
    const gap = 38
    const cardOnLeft = pointX >= width * 0.48
    const cardX = cardOnLeft
      ? Math.max(14, pointX - cardWidth - gap * 2)
      : Math.min(width - cardWidth - 14, pointX + gap * 2)
    const cardY = clamp(
      pointY - cardHeight * 0.55,
      62,
      Math.max(62, height - cardHeight - 22)
    )
    const cardCenterY = cardY + cardHeight / 2
    const cardEdgeX = cardOnLeft ? cardX + cardWidth : cardX
    const polyline = [
      `${pointX},${pointY}`,
      `${pointX},${cardCenterY}`,
      `${cardEdgeX},${cardCenterY}`
    ].join(' ')

    annotationLayout.value = {
      width,
      height,
      pointX,
      pointY,
      cardX,
      cardY,
      cardWidth,
      polyline
    }
  })
}

function scheduleAnnotationPosition() {
  if (!modelReady) return
  nextTick(updateAnnotationPosition)
}

function resize() {
  if (!container.value || !renderer || !camera) return

  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
  scheduleAnnotationPosition()
}

function resetHighlight() {
  for (const [name, mesh] of meshMap) {
    mesh.material.color.setHex(originalColors.get(name) ?? 0xffffff)
    mesh.material.emissive?.setHex(
      originalEmissiveColors.get(name) ?? 0x000000
    )
    if (mesh.material.emissive) {
      mesh.material.emissiveIntensity =
        originalEmissiveIntensity.get(name) ?? 1
    }
  }
}

function highlightNodes(nodeNames, color = 0x1687d9) {
  resetHighlight()
  const highlight = new THREE.Color(color)

  for (const nodeName of nodeNames ?? []) {
    const mesh = meshMap.get(nodeName)
    if (!mesh) continue
    mesh.material.color.copy(highlight)
    if (mesh.material.emissive) {
      mesh.material.emissive.copy(highlight)
      mesh.material.emissiveIntensity = 0.32
    }
  }
}

defineExpose({ highlightNodes, resetHighlight })

watch(
  () => [props.annotation, props.focusNodes],
  () => scheduleAnnotationPosition(),
  { deep: true }
)

onMounted(async () => {
  const host = container.value
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#e7ecef')

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
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.72
  host.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0, 0)
  controls.addEventListener('change', scheduleAnnotationPosition)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x52606c, 0.72))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0)
  keyLight.position.set(280, 220, 180)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0xb8d4ff, 0.25)
  fillLight.position.set(-220, 120, -160)
  scene.add(fillLight)

  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync('/model/pelvicTest.gltf')
  gltf.scene.scale.setScalar(0.9)

  gltf.scene.traverse((node) => {
    if (!node.isMesh) return

    node.material = node.material.clone()
    meshMap.set(node.name, node)
    originalColors.set(node.name, node.material.color.getHex())
    originalEmissiveColors.set(
      node.name,
      node.material.emissive?.getHex() ?? 0x000000
    )
    originalEmissiveIntensity.set(
      node.name,
      node.material.emissiveIntensity ?? 1
    )
  })

  scene.add(gltf.scene)
  camera.lookAt(0, 0, 0)
  modelReady = true
  scheduleAnnotationPosition()

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
  cancelAnimationFrame(annotationFrame)
  resizeObserver?.disconnect()
  controls?.removeEventListener('change', scheduleAnnotationPosition)
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
  <div ref="container" class="pelvic-model">
    <div
      v-if="props.annotation && annotationLayout"
      class="model-annotation"
      aria-live="polite"
    >
      <svg
        class="annotation-connector"
        :width="annotationLayout.width"
        :height="annotationLayout.height"
        :viewBox="`0 0 ${annotationLayout.width} ${annotationLayout.height}`"
      >
        <defs>
          <marker
            id="pain-annotation-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="#1687d9" />
          </marker>
        </defs>
        <polyline
          :points="annotationLayout.polyline"
          fill="none"
          stroke="#1687d9"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          marker-end="url(#pain-annotation-arrow)"
        />
      </svg>

      <span
        class="pain-anchor"
        :style="{
          left: `${annotationLayout.pointX}px`,
          top: `${annotationLayout.pointY}px`
        }"
      >
        <i></i>
      </span>

      <article
        ref="annotationCard"
        class="pain-annotation-card"
        :style="{
          left: `${annotationLayout.cardX}px`,
          top: `${annotationLayout.cardY}px`,
          width: `${annotationLayout.cardWidth}px`
        }"
      >
        <header>
          <span>{{ props.annotation.kicker }}</span>
          <b>{{ props.annotation.code }}</b>
        </header>
        <h3>{{ props.annotation.title }}</h3>
        <p>{{ props.annotation.origin }}</p>
        <ul v-if="props.annotation.functions?.length">
          <li
            v-for="item in props.annotation.functions"
            :key="item"
          >
            {{ item }}
          </li>
        </ul>
      </article>
    </div>
  </div>
</template>

<style scoped>
.pelvic-model {
  position: relative;
  width: 100%;
  min-height: 520px;
  height: 100%;
  overflow: hidden;
  border-radius: 18px;
  background: #e7ecef;
  isolation: isolate;
}

.model-annotation {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

.annotation-connector {
  position: absolute;
  inset: 0;
  overflow: visible;
}

.pain-anchor {
  position: absolute;
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 50%;
  background: rgba(22, 135, 217, 0.2);
  box-shadow:
    0 0 0 7px rgba(22, 135, 217, 0.18),
    0 0 22px rgba(22, 135, 217, 0.85);
  transform: translate(-50%, -50%);
}

.pain-anchor i {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  background: #1687d9;
}

.pain-annotation-card {
  position: absolute;
  z-index: 2;
  padding: 13px 15px;
  border: 1px solid rgba(123, 201, 255, 0.62);
  border-radius: 12px;
  color: #eff8ff;
  background: rgba(12, 54, 88, 0.78);
  box-shadow: 0 14px 34px rgba(6, 35, 58, 0.3);
  backdrop-filter: blur(9px);
}

.pain-annotation-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pain-annotation-card header span {
  color: #8ed7ff;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.pain-annotation-card header b {
  padding: 2px 7px;
  border-radius: 999px;
  color: #dff5ff;
  background: rgba(75, 170, 229, 0.3);
  font-size: 10px;
}

.pain-annotation-card h3 {
  margin: 6px 0 5px;
  color: #ffffff;
  font-size: 16px;
}

.pain-annotation-card p {
  margin: 0;
  color: #d1e9f7;
  font-size: 10px;
  line-height: 1.65;
}

.pain-annotation-card ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.pain-annotation-card li {
  padding: 3px 7px;
  border-radius: 999px;
  color: #dff7ff;
  background: rgba(69, 169, 230, 0.22);
  font-size: 9px;
}
</style>
