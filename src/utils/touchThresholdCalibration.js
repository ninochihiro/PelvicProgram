import { SENSOR_CHANNEL_IDS } from './pressureCalibration.js'
import {
  remapLegacyChannelArray,
  remapLegacyChannels,
  remapVersion2ChannelArray,
  remapVersion2Channels,
  remapVersion3ChannelArray,
  remapVersion3Channels,
  remapVersion4ChannelArray,
  remapVersion4Channels,
  remapVersion5ChannelArray,
  remapVersion5Channels,
  remapVersion6ChannelArray,
  remapVersion6Channels,
  remapVersion7ChannelArray,
  remapVersion7Channels,
  remapVersion8ChannelArray,
  remapVersion8Channels
} from '../data/electrodeLayout.js'

export const TOUCH_THRESHOLD_VERSION = 9
export const TOUCH_THRESHOLD_STORAGE_KEY = 'mpps-touch-thresholds-v1'

function median(values) {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function percentile(values, ratio) {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const position = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * ratio))
  )
  return sorted[position]
}

function findBalancedThreshold(restValues, pressValues) {
  const allValues = [...new Set([...restValues, ...pressValues])].sort(
    (a, b) => a - b
  )
  if (allValues.length < 2) return Number.NaN

  const candidates = []
  candidates.push(allValues[0] - 0.5)
  for (let index = 1; index < allValues.length; index++) {
    candidates.push((allValues[index - 1] + allValues[index]) / 2)
  }
  candidates.push(allValues[allValues.length - 1] + 0.5)

  let bestThreshold = 0
  let bestScore = Number.NEGATIVE_INFINITY

  for (const threshold of candidates) {
    const truePositiveRate =
      pressValues.filter((value) => value >= threshold).length /
      pressValues.length
    const trueNegativeRate =
      restValues.filter((value) => value < threshold).length /
      restValues.length
    const score = truePositiveRate + trueNegativeRate

    if (score > bestScore) {
      bestScore = score
      bestThreshold = threshold
    }
  }

  return bestThreshold
}

function createCalibrationError(message, diagnostics) {
  const error = new Error(message)
  error.diagnostics = diagnostics
  return error
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeSavedChannel(saved, fallback) {
  const threshold = toNullableNumber(saved?.threshold)
  if (!saved || threshold === null) return fallback
  return {
    ...fallback,
    ...saved,
    id: fallback.id,
    baseline: toNullableNumber(saved.baseline),
    threshold,
    releaseThreshold: toNullableNumber(saved.releaseThreshold),
    pressMedian: toNullableNumber(saved.pressMedian),
    averageRaw: toNullableNumber(saved.averageRaw),
    averageDelta: toNullableNumber(saved.averageDelta),
    restP95: toNullableNumber(saved.restP95),
    noiseSigma: toNullableNumber(saved.noiseSigma),
    quality: saved.quality ?? 'fair',
    sampleCount: Number(saved.sampleCount) || 0,
    capturedAt: saved.capturedAt ?? null
  }
}

export function createEmptyTouchThresholdState() {
  return {
    version: TOUCH_THRESHOLD_VERSION,
    scale: 1,
    updatedAt: null,
    baselineValues: Array(15).fill(null),
    noiseValues: Array(15).fill(null),
    channels: SENSOR_CHANNEL_IDS.map((id) => ({
      id,
      baseline: null,
      threshold: null,
      releaseThreshold: null,
      pressMedian: null,
      averageRaw: null,
      averageDelta: null,
      restP95: null,
      noiseSigma: null,
      quality: 'none',
      sampleCount: 0,
      capturedAt: null
    }))
  }
}

export function normalizeTouchThresholdState(input) {
  const empty = createEmptyTouchThresholdState()
  if (!input || typeof input !== 'object') return empty

  const scale = toNullableNumber(input.scale)
  const inputVersion = Number(input.version)
  const usesVersion8Layout = inputVersion === 8
  const usesVersion7Layout = inputVersion === 7
  const usesVersion6Layout = inputVersion === 6
  const usesVersion5Layout = inputVersion === 5
  const usesVersion4Layout = inputVersion === 4
  const usesVersion3Layout = inputVersion === 3
  const usesVersion2Layout = inputVersion === 2
  const usesLegacyLayout =
    !Number.isFinite(inputVersion) || inputVersion < 2
  let sourceBaselineValues = input.baselineValues
  let sourceNoiseValues = input.noiseValues
  let sourceChannels = input.channels

  if (usesVersion8Layout) {
    sourceBaselineValues = remapVersion8ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion8ChannelArray(input.noiseValues)
    sourceChannels = remapVersion8Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesVersion7Layout) {
    sourceBaselineValues = remapVersion7ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion7ChannelArray(input.noiseValues)
    sourceChannels = remapVersion7Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesVersion6Layout) {
    sourceBaselineValues = remapVersion6ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion6ChannelArray(input.noiseValues)
    sourceChannels = remapVersion6Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesVersion5Layout) {
    sourceBaselineValues = remapVersion5ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion5ChannelArray(input.noiseValues)
    sourceChannels = remapVersion5Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesVersion4Layout) {
    sourceBaselineValues = remapVersion4ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion4ChannelArray(input.noiseValues)
    sourceChannels = remapVersion4Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesVersion3Layout) {
    sourceBaselineValues = remapVersion3ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion3ChannelArray(input.noiseValues)
    sourceChannels = remapVersion3Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesVersion2Layout) {
    sourceBaselineValues = remapVersion2ChannelArray(input.baselineValues)
    sourceNoiseValues = remapVersion2ChannelArray(input.noiseValues)
    sourceChannels = remapVersion2Channels(
      input.channels,
      (index) => empty.channels[index]
    )
  } else if (usesLegacyLayout) {
    sourceBaselineValues = remapLegacyChannelArray(input.baselineValues)
    sourceNoiseValues = remapLegacyChannelArray(input.noiseValues)
    sourceChannels = remapLegacyChannels(
      input.channels,
      (index) => empty.channels[index]
    )
  }
  const channelMap = new Map(
    Array.isArray(sourceChannels)
      ? sourceChannels.map((channel) => [channel?.id, channel])
      : []
  )

  return {
    version: TOUCH_THRESHOLD_VERSION,
    scale: scale === null ? 1 : Math.min(2, Math.max(0.5, scale)),
    updatedAt: input.updatedAt ?? null,
    baselineValues: empty.baselineValues.map((_, index) =>
      toNullableNumber(sourceBaselineValues?.[index])
    ),
    noiseValues: empty.noiseValues.map((_, index) =>
      toNullableNumber(sourceNoiseValues?.[index])
    ),
    channels: empty.channels.map((channel) =>
      normalizeSavedChannel(channelMap.get(channel.id), channel)
    )
  }
}

export function calculateTouchThreshold(frames, targetIndex) {
  const restFrames = frames.filter((frame) => frame.phase === 'rest')
  const pressFrames = frames.filter((frame) => frame.phase === 'press')

  if (restFrames.length < 8 || pressFrames.length < 8) {
    throw createCalibrationError('静置或按压样本不足，请重新采集', {
      restSamples: restFrames.length,
      pressSamples: pressFrames.length
    })
  }

  const baselineValues = SENSOR_CHANNEL_IDS.map((_, channelIndex) =>
    median(restFrames.map((frame) => Number(frame.values[channelIndex])))
  )
  const baseline = baselineValues[targetIndex]
  if (!Number.isFinite(baseline)) {
    throw createCalibrationError('目标通道基线无效', {
      targetChannel: SENSOR_CHANNEL_IDS[targetIndex]
    })
  }

  const restDeltas = restFrames.map(
    (frame) => Number(frame.values[targetIndex]) - baseline
  )
  const pressDeltas = pressFrames.map(
    (frame) => Number(frame.values[targetIndex]) - baseline
  )

  const restP95 = percentile(restDeltas, 0.95)
  const restMedian = median(restDeltas)
  const restMad = median(restDeltas.map((value) => Math.abs(value - restMedian)))
  const noiseSigma = Math.max(0.5, restMad * 1.4826)
  const pressMedian = median(pressDeltas)
  const pressP20 = percentile(pressDeltas, 0.2)
  const pressP80 = percentile(pressDeltas, 0.8)
  const pressMax = Math.max(...pressDeltas)
  const restMax = Math.max(...restDeltas)
  const respondedCount = pressDeltas.filter(
    (value) => value > restP95 + 0.5
  ).length
  const diagnostics = {
    targetChannel: SENSOR_CHANNEL_IDS[targetIndex],
    baseline: Math.round(baseline * 10) / 10,
    restP95: Math.round(restP95 * 10) / 10,
    restMax: Math.round(restMax * 10) / 10,
    pressMedian: Math.round(pressMedian * 10) / 10,
    pressP80: Math.round(pressP80 * 10) / 10,
    pressMax: Math.round(pressMax * 10) / 10,
    noiseSigma: Math.round(noiseSigma * 10) / 10,
    restSamples: restFrames.length,
    pressSamples: pressFrames.length,
    respondedCount
  }

  if (
    !Number.isFinite(pressMedian) ||
    pressMax < restP95 + 0.5 ||
    respondedCount < Math.min(3, pressFrames.length) ||
    noiseSigma <= 0
  ) {
    throw createCalibrationError(
      '目标位点响应不足，请确认按压位置并重新采集',
      diagnostics
    )
  }

  const balancedThreshold = findBalancedThreshold(restDeltas, pressDeltas)
  let threshold = Math.max(
    1,
    restP95 + 0.5,
    Number.isFinite(balancedThreshold) ? balancedThreshold : 1
  )
  if (pressP20 > threshold + 2) {
    threshold = Math.min(threshold, pressP20 - 1)
  }

  if (threshold > pressP80) {
    throw createCalibrationError(
      '按压样本与静置噪声重叠，建议加大按压力度或重新固定传感器',
      diagnostics
    )
  }

  const releaseThreshold = Math.min(
    threshold - 1,
    restP95 + Math.max(1, (threshold - restP95) * 0.35)
  )
  const signalToNoise = (pressP80 - restP95) / noiseSigma
  const quality =
    signalToNoise >= 5 ? 'good' : signalToNoise >= 2.5 ? 'fair' : 'poor'

  const pressChannelMedians = SENSOR_CHANNEL_IDS.map((_, channelIndex) =>
    median(
      pressFrames.map(
        (frame) =>
          Number(frame.values[channelIndex]) - baselineValues[channelIndex]
      )
    )
  )
  const strongestIndex = pressChannelMedians.reduce(
    (best, value, index, values) =>
      value > values[best] ? index : best,
    0
  )

  return {
    baseline,
    threshold: Math.round(threshold),
    releaseThreshold: Math.round(Math.max(0, releaseThreshold)),
    pressMedian: Math.round(pressMedian),
    restP95: Math.round(restP95),
    noiseSigma: Math.round(noiseSigma * 10) / 10,
    quality,
    strongestIndex,
    sampleCount: frames.length,
    restMax: Math.round(restMax),
    pressMax: Math.round(pressMax)
  }
}
