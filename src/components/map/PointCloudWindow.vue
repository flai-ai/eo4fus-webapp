<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import Button from 'primevue/button'
import PointCloudViewer from '../PointCloudViewer.vue'
import { usePointCloud } from '@/composables/usePointCloud.js'

/** Share of the map area the window covers when it opens */
const OPEN_FRACTION = 0.7
const MIN_WIDTH = 320
const MIN_HEIGHT = 240

const { t } = useI18n()
const { pointcloudId, aoi, closeWindow } = usePointCloud()

const root = ref(null)
const rect = ref({ left: 0, top: 0, width: MIN_WIDTH, height: MIN_HEIGHT })
const isMaximized = ref(false)
/** True while dragging or resizing, so the iframe stops swallowing the pointer */
const isPointerBusy = ref(false)
let restoreRect = null
let stopPointerTracking = null

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Bounds of the map stage the window is confined to */
function stageBounds() {
  const stage = root.value?.parentElement
  return stage ? stage.getBoundingClientRect() : null
}

onMounted(() => {
  const bounds = stageBounds()
  if (!bounds) return
  const width = clamp(Math.round(bounds.width * OPEN_FRACTION), MIN_WIDTH, bounds.width)
  const height = clamp(Math.round(bounds.height * OPEN_FRACTION), MIN_HEIGHT, bounds.height)
  rect.value = {
    left: Math.round((bounds.width - width) / 2),
    top: Math.round((bounds.height - height) / 2),
    width,
    height,
  }
})

onBeforeUnmount(() => stopPointerTracking?.())

/**
 * Follow the pointer until it is released. Listeners are on the window, and the iframe
 * ignores pointer events meanwhile so it cannot capture the gesture.
 */
function trackPointer(onMove) {
  isPointerBusy.value = true

  function move(event) {
    onMove(event)
  }

  function up() {
    stopPointerTracking?.()
  }

  stopPointerTracking = () => {
    isPointerBusy.value = false
    globalThis.removeEventListener('pointermove', move)
    globalThis.removeEventListener('pointerup', up)
    globalThis.removeEventListener('pointercancel', up)
    stopPointerTracking = null
  }

  globalThis.addEventListener('pointermove', move)
  globalThis.addEventListener('pointerup', up)
  globalThis.addEventListener('pointercancel', up)
}

function startDrag(event) {
  if (isMaximized.value) return
  // The header carries the maximize and close buttons
  if (event.target.closest('button')) return
  const bounds = stageBounds()
  if (!bounds) return

  const startX = event.clientX
  const startY = event.clientY
  const { left, top, width, height } = rect.value

  trackPointer((moveEvent) => {
    rect.value = {
      width,
      height,
      left: clamp(left + moveEvent.clientX - startX, 0, bounds.width - width),
      top: clamp(top + moveEvent.clientY - startY, 0, bounds.height - height),
    }
  })
}

function startResize(event) {
  if (isMaximized.value) return
  const bounds = stageBounds()
  if (!bounds) return

  const startX = event.clientX
  const startY = event.clientY
  const { left, top, width, height } = rect.value

  trackPointer((moveEvent) => {
    rect.value = {
      left,
      top,
      width: clamp(width + moveEvent.clientX - startX, MIN_WIDTH, bounds.width - left),
      height: clamp(height + moveEvent.clientY - startY, MIN_HEIGHT, bounds.height - top),
    }
  })
}

function toggleMaximize() {
  const bounds = stageBounds()
  if (!bounds) return
  if (isMaximized.value) {
    isMaximized.value = false
    if (restoreRect) rect.value = restoreRect
    restoreRect = null
    return
  }
  restoreRect = { ...rect.value }
  isMaximized.value = true
  rect.value = { left: 0, top: 0, width: bounds.width, height: bounds.height }
}

// Keep the window inside the map when the map is resized
useResizeObserver(
  () => root.value?.parentElement,
  ([entry]) => {
    const { width: stageWidth, height: stageHeight } = entry.contentRect
    if (isMaximized.value) {
      rect.value = { left: 0, top: 0, width: stageWidth, height: stageHeight }
      return
    }
    const width = clamp(rect.value.width, MIN_WIDTH, stageWidth)
    const height = clamp(rect.value.height, MIN_HEIGHT, stageHeight)
    rect.value = {
      width,
      height,
      left: clamp(rect.value.left, 0, stageWidth - width),
      top: clamp(rect.value.top, 0, stageHeight - height),
    }
  },
)
</script>

<template>
  <div
    ref="root"
    class="pointcloud-window"
    :style="{
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    }"
  >
    <div
      class="pointcloud-window__header"
      :class="{ 'pointcloud-window__header--fixed': isMaximized }"
      @pointerdown="startDrag"
    >
      <i class="pi pi-bars pointcloud-window__grip" />
      <span class="pointcloud-window__title">{{ t('pointcloud.title') }}</span>
      <Button
        :icon="isMaximized ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
        text
        rounded
        severity="secondary"
        size="small"
        :aria-label="isMaximized ? t('pointcloud.restore') : t('pointcloud.maximize')"
        @click="toggleMaximize"
      />
      <Button
        icon="pi pi-times"
        text
        rounded
        severity="secondary"
        size="small"
        :aria-label="t('pointcloud.close')"
        @click="closeWindow"
      />
    </div>

    <div
      class="pointcloud-window__body"
      :class="{ 'pointcloud-window__body--inert': isPointerBusy }"
    >
      <PointCloudViewer
        :pointcloud-id="pointcloudId"
        :aoi="aoi"
      />
    </div>

    <div
      v-if="!isMaximized"
      class="pointcloud-window__resize"
      @pointerdown="startResize"
    />
  </div>
</template>

<style scoped>
.pointcloud-window {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-panel-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.pointcloud-window__header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.25rem 0.25rem 0.6rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
  cursor: move;
  touch-action: none;
  user-select: none;
}

.pointcloud-window__header--fixed {
  cursor: default;
}

.pointcloud-window__grip {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.pointcloud-window__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  font-weight: 700;
}

.pointcloud-window__body {
  flex: 1;
  min-height: 0;
}

.pointcloud-window__body--inert {
  pointer-events: none;
}

.pointcloud-window__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(
    135deg,
    transparent 0 45%,
    var(--color-border) 45% 55%,
    transparent 55% 70%,
    var(--color-border) 70% 80%,
    transparent 80%
  );
}
</style>
