<script setup>
import { computed } from 'vue'

/** Embedded Flai point cloud viewer. The title and buttons are provided by the parent. */
const props = defineProps({
  pointcloudId: {
    type: String,
    required: true,
  },
  aoi: {
    type: String,
    default: '',
  },
})

const flaiAppUrl = import.meta.env.VITE_FLAI_APP_URL

const src = computed(
  () => `${flaiAppUrl}/#/embedded?id=${props.pointcloudId}${props.aoi ? `&aoi=${props.aoi}` : ''}`,
)
</script>

<template>
  <iframe
    class="pointcloud-viewer"
    :src="src"
    allow="fullscreen"
  />
</template>

<style scoped>
.pointcloud-viewer {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--color-background-soft);
}
</style>
