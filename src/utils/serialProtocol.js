export const CHANNEL_COUNT = 15
export const ADC_MAX = 16383
export const ADC_FULL_SCALE_3V = 3
export const ADC_FULL_SCALE_1V2 = 1.2

const RANGE_MASK_MAX = (1 << CHANNEL_COUNT) - 1

function parseNumber(token) {
  const text = String(token ?? '').trim()
  if (!text) return Number.NaN
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}

/**
 * Firmware frame:
 *   rawA01,...,rawA15
 * or, when range reporting is enabled:
 *   rawA01,...,rawA15,rangeMask
 *
 * Bit i in rangeMask is 1 for the 3 V range and 0 for the 1.2 V range.
 * All normalized values are converted to the equivalent 3 V-range ADC scale.
 */
export function parseSerialFrame(input) {
  const tokens = String(input ?? '')
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)

  if (tokens.length < CHANNEL_COUNT) return null

  const rawValues = tokens
    .slice(0, CHANNEL_COUNT)
    .map(parseNumber)

  if (
    rawValues.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 65535
    )
  ) {
    return null
  }

  let rangeMask = null
  if (tokens.length > CHANNEL_COUNT) {
    const candidate = parseNumber(tokens[CHANNEL_COUNT])
    if (
      Number.isInteger(candidate) &&
      candidate >= 0 &&
      candidate <= RANGE_MASK_MAX
    ) {
      rangeMask = candidate
    }
  }

  const values = rawValues.map((value, index) => {
    if (rangeMask === null) return value
    const uses3VRange = (rangeMask & (1 << index)) !== 0
    return uses3VRange ? value : value * (ADC_FULL_SCALE_1V2 / ADC_FULL_SCALE_3V)
  })

  return {
    rawValues,
    values,
    rangeMask,
    hasRangeMask: rangeMask !== null,
    tokenCount: tokens.length
  }
}

export function valueToVoltage(value, fullScale = ADC_FULL_SCALE_3V) {
  return (Number(value) * fullScale) / (ADC_MAX + 1)
}

export function buildBaseline(frames) {
  if (!Array.isArray(frames) || !frames.length) {
    return Array(CHANNEL_COUNT).fill(null)
  }

  return Array.from({ length: CHANNEL_COUNT }, (_, channel) => {
    const total = frames.reduce(
      (sum, frame) => sum + (Number.isFinite(frame[channel]) ? frame[channel] : 0),
      0
    )
    return total / frames.length
  })
}

export function subtractBaseline(values, baseline) {
  return values.map((value, index) => {
    const base = Number.isFinite(baseline?.[index]) ? baseline[index] : 0
    return Math.max(0, value - base)
  })
}

/**
 * Adds release hysteresis so a held touch is emitted only once.
 */
export function updateChannelLatch(
  values,
  previousActive,
  threshold,
  releaseThreshold
) {
  const valueAt = (source, index) => {
    const value = Number(
      Array.isArray(source) ? source[index] : source
    )
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }

  const active = values.map((value, index) => {
    const thresholdValue = valueAt(threshold, index)
    const releaseValue =
      releaseThreshold === undefined
        ? Math.max(1, thresholdValue * 0.65)
        : Math.max(1, valueAt(releaseThreshold, index))
    return previousActive?.[index]
      ? value >= releaseValue
      : value >= thresholdValue
  })
  const started = active.map(
    (isActive, index) => isActive && !previousActive?.[index]
  )

  return { active, started }
}

export function strongestStartedChannel(values, started) {
  let strongest = null

  for (let index = 0; index < CHANNEL_COUNT; index++) {
    if (!started[index]) continue
    const value = values[index]
    if (!Number.isFinite(value)) continue
    if (!strongest || value > strongest.value) {
      strongest = { index, value }
    }
  }

  return strongest
}
