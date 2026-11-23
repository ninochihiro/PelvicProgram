import {
  ELECTRODE_CHANNEL_IDS,
  remapLegacyChannels,
  remapVersion2Channels,
  remapVersion3Channels,
  remapVersion4Channels,
  remapVersion5Channels,
  remapVersion6Channels,
  remapVersion7Channels,
  remapVersion8Channels
} from '../data/electrodeLayout.js'

export const CALIBRATION_VERSION = 9
export const PRESSURE_UNIT = 'N'
export const PRESSURE_PRESETS = [0, 5, 10, 20, 30, 50, 100, 200]
export const CALIBRATION_STORAGE_KEY = 'mpps-pressure-calibration-v1'

export const SENSOR_CHANNEL_IDS = ELECTRODE_CHANNEL_IDS

function toFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : Number.NaN
}

export function sortCalibrationPoints(points) {
  return [...(points ?? [])]
    .map((point) => ({
      pressureN: toFiniteNumber(point.pressureN),
      adc: toFiniteNumber(point.adc),
      spread: Number.isFinite(Number(point.spread)) ? Number(point.spread) : 0,
      pressureSpread: Number.isFinite(Number(point.pressureSpread))
        ? Number(point.pressureSpread)
        : 0,
      sampleCount: Number.isFinite(Number(point.sampleCount))
        ? Number(point.sampleCount)
        : 1,
      capturedAt: point.capturedAt ?? null
    }))
    .filter(
      (point) =>
        Number.isFinite(point.pressureN) &&
        point.pressureN >= 0 &&
        Number.isFinite(point.adc) &&
        point.adc >= 0
    )
    .sort((a, b) => a.pressureN - b.pressureN)
}

export function validateCalibrationPoints(
  points,
  { requireMinimum = true } = {}
) {
  const sorted = sortCalibrationPoints(points)

  if (sorted.length < (requireMinimum ? 2 : 1)) {
    return {
      valid: false,
      reason: requireMinimum
        ? '至少需要两个不同压力点'
        : '至少需要采集一个压力点'
    }
  }

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    const current = sorted[index]

    if (current.pressureN === previous.pressureN) {
      return {
        valid: false,
        reason: '压力点不能重复'
      }
    }

    if (current.adc <= previous.adc) {
      return {
        valid: false,
        reason: `压力增大时 ADC 应同步增大，请重新采集 ${current.pressureN} N`
      }
    }
  }

  return {
    valid: true,
    reason: ''
  }
}

export function createEmptyCalibration() {
  return {
    version: CALIBRATION_VERSION,
    updatedAt: null,
    channels: SENSOR_CHANNEL_IDS.map((id) => ({
      id,
      points: []
    }))
  }
}

export function normalizeCalibrationData(input) {
  const empty = createEmptyCalibration()
  if (!input || typeof input !== 'object') return empty
  if (Number(input.version) !== CALIBRATION_VERSION) {
    const inputVersion = Number(input.version)
    const migratedChannels =
      inputVersion === 8
        ? remapVersion8Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : inputVersion === 7
        ? remapVersion7Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : inputVersion === 6
        ? remapVersion6Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : inputVersion === 5
        ? remapVersion5Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : inputVersion === 4
        ? remapVersion4Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : inputVersion === 3
        ? remapVersion3Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : inputVersion === 2
        ? remapVersion2Channels(
            input.channels,
            (index) => empty.channels[index]
          )
        : remapLegacyChannels(input.channels, (index) => empty.channels[index])
    return {
      version: CALIBRATION_VERSION,
      updatedAt: input.updatedAt ?? null,
      channels: migratedChannels.map((channel) => ({
        id: channel.id,
        points: sortCalibrationPoints(channel.points)
      }))
    }
  }

  const channelMap = new Map(
    Array.isArray(input.channels)
      ? input.channels.map((channel) => [channel?.id, channel])
      : []
  )

  return {
    version: CALIBRATION_VERSION,
    updatedAt: input.updatedAt ?? null,
    channels: empty.channels.map((channel) => ({
      id: channel.id,
      points: sortCalibrationPoints(channelMap.get(channel.id)?.points)
    }))
  }
}

export function hasUsableCalibration(points) {
  return validateCalibrationPoints(points).valid
}

/**
 * Piecewise-linear conversion from ADC to pressure.
 * Calibration points are defined as pressure(ADC), then inverted
 * for live ADC-to-pressure conversion.
 */
export function interpolatePressure(adc, points) {
  const value = toFiniteNumber(adc)
  const sorted = sortCalibrationPoints(points)
  if (!Number.isFinite(value) || sorted.length < 2) return null

  const validation = validateCalibrationPoints(sorted)
  if (!validation.valid) return null

  if (value <= sorted[0].adc) {
    const next = sorted[1]
    const first = sorted[0]
    const slope =
      (next.pressureN - first.pressureN) / (next.adc - first.adc)
    return Math.max(0, first.pressureN + (value - first.adc) * slope)
  }

  for (let index = 1; index < sorted.length; index++) {
    const left = sorted[index - 1]
    const right = sorted[index]
    if (value <= right.adc) {
      const ratio = (value - left.adc) / (right.adc - left.adc)
      return left.pressureN + ratio * (right.pressureN - left.pressureN)
    }
  }

  const left = sorted[sorted.length - 2]
  const right = sorted[sorted.length - 1]
  const slope = (right.pressureN - left.pressureN) / (right.adc - left.adc)
  return right.pressureN + (value - right.adc) * slope
}
