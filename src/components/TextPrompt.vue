<script setup>
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '训练提示'
  },
  message: {
    type: String,
    default: ''
  },
  tone: {
    type: String,
    default: 'info'
  },
  duration: {
    type: Number,
    default: 3600
  }
})

const emit = defineEmits(['close'])

let closeTimer = null

function clearCloseTimer() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

function scheduleClose() {
  clearCloseTimer()
  if (!props.visible || props.duration <= 0) return
  closeTimer = window.setTimeout(() => emit('close'), props.duration)
}

watch(
  () => [props.visible, props.message, props.tone, props.duration],
  scheduleClose,
  { immediate: true }
)

onBeforeUnmount(clearCloseTimer)
</script>

<template>
  <Teleport to="body">
    <Transition name="prompt">
      <section
        v-if="visible && message"
        class="text-prompt"
        :class="`tone-${tone}`"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div class="prompt-heading">
          <span>{{ title }}</span>
          <button type="button" aria-label="关闭提示" @click="emit('close')">
            ×
          </button>
        </div>
        <p>{{ message }}</p>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.text-prompt {
  position: fixed;
  top: 24px;
  left: 50%;
  z-index: 5000;
  width: min(620px, calc(100vw - 32px));
  padding: 16px 18px;
  border: 1px solid #c9dbe5;
  border-left: 5px solid #2d86c9;
  border-radius: 15px;
  color: #193044;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 55px rgba(12, 35, 55, 0.25);
  transform: translateX(-50%);
}

.prompt-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.prompt-heading span {
  color: #2d6f98;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.prompt-heading button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #5b7284;
  background: #edf3f7;
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
}

p {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.tone-success {
  border-left-color: #20a77f;
  background: #f2fcf9;
}

.tone-warning {
  border-left-color: #d99823;
  background: #fffaf0;
}

.tone-error {
  border-left-color: #d84c58;
  background: #fff5f5;
}

.prompt-enter-active,
.prompt-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.prompt-enter-from,
.prompt-leave-to {
  opacity: 0;
  transform: translate(-50%, -12px);
}
</style>
