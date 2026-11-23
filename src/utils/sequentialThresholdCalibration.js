import { SENSOR_CHANNEL_IDS } from './pressureCalibration.js'

function median(values) {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function timeWeightedChannelMeans(frames) {
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error('10秒采集帧数不足')
  }

  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp)
  const durationMs = sorted[sorted.length - 1].timestamp - sorted[0].timestamp
  if (durationMs < 1000) {
    throw new Error('有效采集时间不足')
  }

  return SENSOR_CHANNEL_IDS.map((_, channelIndex) => {
    let integral = 0

    for (let index = 1; index < sorted.length; index++) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      const deltaSeconds = Math.max(
        0,
        (current.timestamp - previous.timestamp) / 1000
      )
      const previousValue = Number(previous.values[channelIndex])
      const currentValue = Number(current.values[channelIndex])
      if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) {
        continue
      }
      integral += ((previousValue + currentValue) / 2) * deltaSeconds
    }

    return integral / (durationMs / 1000)
  })
}

export function estimateChannelNoise(frames) {
  return SENSOR_CHANNEL_IDS.map((_, channelIndex) => {
    const values = frames
      .map((frame) => Number(frame.values[channelIndex]))
      .filter(Number.isFinite)
    if (!values.length) return 0
    const center = median(values)
    const mad = median(values.map((value) => Math.abs(value - center)))
    return Math.max(0.5, mad * 1.4826)
  })
}

export function calculateSinglePressThreshold({
  targetIndex,
  baselineValues,
  noiseValues,
  pressAverage
}) {
  const baseline = Number(baselineValues[targetIndex])
  const averageRaw = Number(pressAverage[targetIndex])
  const delta = averageRaw - baseline
  const noise = Math.max(0.5, Number(noiseValues[targetIndex]) || 0.5)

  if (!Number.isFinite(delta) || delta < Math.max(1, noise * 2)) {
    const error = new Error(
      '当前位点10秒平均响应不足，请确认按压位置后重新采集'
    )
    error.diagnostics = {
      baseline: Math.round(baseline * 10) / 10,
      averageRaw: Math.round(averageRaw * 10) / 10,
      averageDelta: Math.round(delta * 10) / 10,
      noiseSigma: Math.round(noise * 10) / 10
    }
    throw error
  }

  const signalToNoise = delta / noise
  const threshold = Math.max(1, Math.round(delta))
  const strongestIndex = SENSOR_CHANNEL_IDS.reduce(
    (best, _, index) => {
      const channelDelta = Number(pressAverage[index]) - baselineValues[index]
      return channelDelta > best.delta
        ? { index, delta: channelDelta }
        : best
    },
    { index: 0, delta: Number.NEGATIVE_INFINITY }
  ).index

  return {
    baseline,
    threshold,
    releaseThreshold: Math.max(0, Math.round(threshold * 0.65)),
    pressMedian: Math.round(delta),
    restP95: 0,
    noiseSigma: Math.round(noise * 10) / 10,
    quality:
      signalToNoise >= 5 ? 'good' : signalToNoise >= 2 ? 'fair' : 'poor',
    strongestIndex,
    sampleCount: 1,
    averageRaw: Math.round(averageRaw * 10) / 10,
    averageDelta: Math.round(delta * 10) / 10,
    capturedAt: new Date().toISOString()
  }
}
