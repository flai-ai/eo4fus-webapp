import { ref, shallowRef } from 'vue'

const isPopupOpen = ref(false)
const isWfsLoading = ref(false)
const popupCoordinate = ref(null)
const popupFeatures = shallowRef([])
const popupArea = ref(null)
const isAreaTooLarge = ref(false)

export function useFeaturePopup() {
  function openPopup(coordinate, features, area = null) {
    popupCoordinate.value = coordinate
    popupFeatures.value = features
    popupArea.value = area
    isAreaTooLarge.value = false
    isPopupOpen.value = true
  }

  function closePopup() {
    isPopupOpen.value = false
    isAreaTooLarge.value = false
    popupCoordinate.value = null
    // popupFeatures, popupArea and isWfsLoading persist until the next openPopup(),
    // so useResultsPanel can still read the WFS context after the popup closes.
  }

  return { isPopupOpen, isWfsLoading, popupCoordinate, popupFeatures, popupArea, isAreaTooLarge, openPopup, closePopup }
}
