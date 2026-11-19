import { ref, watch } from 'vue'
import { useMap } from './useMap.js'

const scale = ref(null)

function calculateScale(view) {
  const resolution = view.getResolution()
  const projection = view.getProjection()
  const mpu = projection.getMetersPerUnit()
  const pointResolution = resolution * mpu
  // Convert to a round scale number (1:N)
  scale.value = Math.round(pointResolution * 96 * 39.3701)
}

export function useMapScale() {
  const { map } = useMap()

  function onMoveEnd() {
    const view = map.value?.getView()
    if (view) calculateScale(view)
  }

  watch(
    map,
    (newMap, oldMap) => {
      if (oldMap) oldMap.un('moveend', onMoveEnd)
      if (newMap) {
        newMap.on('moveend', onMoveEnd)
        // Initial calculation
        const view = newMap.getView()
        if (view) calculateScale(view)
      }
    },
    { immediate: true },
  )

  return { scale }
}
