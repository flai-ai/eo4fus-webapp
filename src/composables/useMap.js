import { shallowRef } from 'vue'

/** Module-scope shared OL Map reference */
const map = shallowRef(null)

export function useMap() {
  return { map }
}
