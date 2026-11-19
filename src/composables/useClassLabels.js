import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CLASS_SETS } from '@/config/palette.js'

/**
 * Localized names of a classified raster's classes, in class order.
 * Classes without a label (e.g. overview artefacts) fall back to "Class n".
 */
export function useClassLabels() {
  const { t, te } = useI18n()

  function labelsFor(classSet) {
    const keys = CLASS_SETS[classSet]?.labelKeys ?? []
    return keys.map((key, cls) => (te(key) ? t(key) : t('results.classNumber', { k: cls })))
  }

  /** Name for one class value, or "Class n" when the set does not name it */
  function classLabel(classSet, classValue) {
    const key = CLASS_SETS[classSet]?.labelKeys?.[classValue]
    return key && te(key) ? t(key) : t('results.classNumber', { k: classValue })
  }

  return { labelsFor, classLabel, speciesLabels: computed(() => labelsFor('species')) }
}
