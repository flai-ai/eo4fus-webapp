import { ref, watch } from 'vue'
import { toLonLat } from 'ol/proj'
import { useThrottleFn } from '@vueuse/core'
import { useMap } from './useMap.js'

const coordinates = ref(null)

export function useMouseCoordinates() {
  const { map } = useMap()

  function onPointerMove(evt) {
    if (evt.dragging) return
    const [lon, lat] = toLonLat(evt.coordinate)
    coordinates.value = { lon, lat }
  }

  const throttledPointerMove = useThrottleFn(onPointerMove, 100)

  watch(
    map,
    (newMap, oldMap) => {
      if (oldMap) oldMap.un('pointermove', throttledPointerMove)
      if (newMap) newMap.on('pointermove', throttledPointerMove)
    },
    { immediate: true },
  )

  return { coordinates }
}
