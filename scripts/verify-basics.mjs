import assert from 'node:assert/strict'
import {
  noTouchRegions,
  painPoints,
  sameAnswer,
  sameNoTouchAnswer
} from '../src/data/pelvicTraining.js'
import {
  parseSerialFrame,
  strongestStartedChannel,
  updateChannelLatch
} from '../src/utils/serialProtocol.js'
import {
  createEmptyCalibration,
  interpolatePressure,
  normalizeCalibrationData,
  validateCalibrationPoints
} from '../src/utils/pressureCalibration.js'
import {
  extractPressureFrames,
  parsePressureFrame
} from '../src/utils/pressureGauge.js'
import {
  calculateTouchThreshold,
  createEmptyTouchThresholdState,
  normalizeTouchThresholdState
} from '../src/utils/touchThresholdCalibration.js'
import {
  ELECTRODE_CHANNEL_IDS,
  ELECTRODE_LAYOUT,
  remapLegacyChannelArray,
  remapVersion2ChannelArray
} from '../src/data/electrodeLayout.js'
import {
  calculateSinglePressThreshold,
  timeWeightedChannelMeans
} from '../src/utils/sequentialThresholdCalibration.js'

const legacyFrame = parseSerialFrame(Array(15).fill(1000).join(','))
assert.ok(legacyFrame)
assert.equal(legacyFrame.hasRangeMask, false)
assert.equal(legacyFrame.values.length, 15)

const legacyOrderedValues = Array.from(
  { length: 15 },
  (_, index) => (index + 1) * 100
)
const displayOrderedValues = remapLegacyChannelArray(legacyOrderedValues)
assert.equal(displayOrderedValues[0], 100)
assert.equal(displayOrderedValues[14], 1500)
assert.deepEqual(
  ELECTRODE_LAYOUT.map((channel) => channel.id),
  ELECTRODE_CHANNEL_IDS
)
assert.equal(ELECTRODE_LAYOUT[0].legacyId, 'A01')
assert.equal(ELECTRODE_LAYOUT[7].legacyId, 'A08')
assert.equal(ELECTRODE_LAYOUT[14].legacyId, 'A15')
const version2OrderedValues = Array.from(
  { length: 15 },
  (_, index) => (index + 1) * 100
)
assert.equal(remapVersion2ChannelArray(version2OrderedValues)[0], 1300)
assert.equal(remapVersion2ChannelArray(version2OrderedValues)[14], 300)

const lowRangeFrame = parseSerialFrame(
  [16384, ...Array(14).fill(1000), 0].join(',')
)
assert.ok(lowRangeFrame)
assert.equal(lowRangeFrame.hasRangeMask, true)
assert.ok(Math.abs(lowRangeFrame.values[0] - 16384 * 0.4) < 0.001)

const highRangeFrame = parseSerialFrame(
  [16384, ...Array(14).fill(1000), 1].join(',')
)
assert.ok(highRangeFrame)
assert.equal(highRangeFrame.values[0], 16384)

const invalidFrame = parseSerialFrame('1000,2000,not-a-number')
assert.equal(invalidFrame, null)

const firstLatch = updateChannelLatch(
  [900, 100, 100],
  Array(15).fill(false),
  800
)
const heldLatch = updateChannelLatch([900, 100, 100], firstLatch.active, 800)
assert.equal(strongestStartedChannel([900, 100, 100], firstLatch.started).index, 0)
assert.equal(heldLatch.started.some(Boolean), false)

for (const point of painPoints) {
  assert.equal(sameAnswer(point.code, point), true)
  assert.equal(sameAnswer(point.title, point), true)
  assert.equal(sameAnswer(`${point.region}${point.muscle}`, point), true)
}

const leftPiriformis = painPoints.find((point) => point.id === 'left-piriformis')
const rightPiriformis = painPoints.find((point) => point.id === 'right-piriformis')
assert.equal(sameAnswer('梨状肌', leftPiriformis), false)
assert.equal(sameAnswer('左侧梨状肌', leftPiriformis), true)
assert.equal(sameAnswer('左侧梨状肌', rightPiriformis), false)
assert.equal(sameAnswer('右侧梨状肌', rightPiriformis), true)

const leftCoccygeus = painPoints.find((point) => point.id === 'left-coccygeus')
assert.equal(sameAnswer('左侧坐骨尾骨肌', leftCoccygeus), true)

const urethra = noTouchRegions.find((region) => region.id === 'urethra')
const rectum = noTouchRegions.find((region) => region.id === 'rectum')
assert.equal(sameNoTouchAnswer('尿道', urethra), true)
assert.equal(sameNoTouchAnswer('直肠肛管', rectum), true)
assert.equal(sameNoTouchAnswer('梨状肌', rectum), false)

const calibrationPoints = [
  { pressureN: 0, adc: 1000 },
  { pressureN: 5, adc: 2000 },
  { pressureN: 10, adc: 3000 },
  { pressureN: 20, adc: 5000 }
]
assert.equal(validateCalibrationPoints(calibrationPoints).valid, true)
assert.equal(interpolatePressure(1000, calibrationPoints), 0)
assert.equal(interpolatePressure(2500, calibrationPoints), 7.5)
assert.equal(interpolatePressure(6000, calibrationPoints), 25)
assert.equal(
  validateCalibrationPoints([
    { pressureN: 0, adc: 2000 },
    { pressureN: 10, adc: 1000 }
  ]).valid,
  false
)

const calibration = createEmptyCalibration()
calibration.channels[0].points = calibrationPoints
const normalizedCalibration = normalizeCalibrationData(calibration)
assert.equal(normalizedCalibration.channels.length, 15)
assert.equal(normalizedCalibration.channels[0].points.length, 4)

const legacyPressureCalibration = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 1000 + index },
      { pressureN: 5, adc: 2000 + index }
    ]
  }))
}
const migratedPressure = normalizeCalibrationData(legacyPressureCalibration)
assert.equal(migratedPressure.version, 9)
assert.equal(
  migratedPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  1000
)
assert.equal(
  migratedPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  1014
)
const version2PressureCalibration = {
  version: 2,
  channels: version2OrderedValues.map((value, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 2000 + index },
      { pressureN: 5, adc: 3000 + index }
    ]
  }))
}
const remigratedPressure = normalizeCalibrationData(
  version2PressureCalibration
)
assert.equal(remigratedPressure.version, 9)
assert.equal(
  remigratedPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  2012
)
assert.equal(
  remigratedPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  2002
)
const version3PressureCalibration = {
  version: 3,
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 4000 + index },
      { pressureN: 5, adc: 5000 + index }
    ]
  }))
}
const reversedPressure = normalizeCalibrationData(
  version3PressureCalibration
)
assert.equal(reversedPressure.version, 9)
assert.equal(
  reversedPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  4014
)
assert.equal(
  reversedPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  4000
)
const version4PressureCalibration = {
  version: 4,
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 6000 + index },
      { pressureN: 5, adc: 7000 + index }
    ]
  }))
}
const xOrderedPressure = normalizeCalibrationData(
  version4PressureCalibration
)
assert.equal(xOrderedPressure.version, 9)
assert.equal(
  xOrderedPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  6000
)
assert.equal(
  xOrderedPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  6014
)
const version5PressureCalibration = {
  version: 5,
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 7000 + index },
      { pressureN: 5, adc: 8000 + index }
    ]
  }))
}
const uOrderedPressure = normalizeCalibrationData(
  version5PressureCalibration
)
assert.equal(uOrderedPressure.version, 9)
assert.equal(
  uOrderedPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  7012
)
assert.equal(
  uOrderedPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  7002
)
const version6PressureCalibration = {
  version: 6,
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 8000 + index },
      { pressureN: 5, adc: 9000 + index }
    ]
  }))
}
const mirroredPressure = normalizeCalibrationData(
  version6PressureCalibration
)
assert.equal(mirroredPressure.version, 9)
assert.equal(
  mirroredPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  8014
)
assert.equal(
  mirroredPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  8000
)
const version7PressureCalibration = {
  version: 7,
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 9000 + index },
      { pressureN: 5, adc: 10000 + index }
    ]
  }))
}
const finalMirrorPressure = normalizeCalibrationData(
  version7PressureCalibration
)
assert.equal(finalMirrorPressure.version, 9)
assert.equal(
  finalMirrorPressure.channels.find((channel) => channel.id === 'A01').points[0]
    .adc,
  9000
)
assert.equal(
  finalMirrorPressure.channels.find((channel) => channel.id === 'A15').points[0]
    .adc,
  9014
)
const version8PressureCalibration = {
  version: 8,
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    points: [
      { pressureN: 0, adc: 10000 + index },
      { pressureN: 5, adc: 11000 + index }
    ]
  }))
}
const originalOrderPressure = normalizeCalibrationData(
  version8PressureCalibration
)
assert.equal(originalOrderPressure.version, 9)
assert.equal(
  originalOrderPressure.channels.find((channel) => channel.id === 'A01')
    .points[0].adc,
  10002
)
assert.equal(
  originalOrderPressure.channels.find((channel) => channel.id === 'A15')
    .points[0].adc,
  10012
)

const pressureFrame = Buffer.from([
  0x55, 0x01, 0x2b, 0x30, 0x30, 0x30, 0x31, 0x32
])
assert.equal(parsePressureFrame(pressureFrame), 1.8)
const pressureExtraction = extractPressureFrames(
  Buffer.from([0x00]),
  Buffer.concat([Buffer.from([0x55, 0x02]), pressureFrame])
)
assert.equal(pressureExtraction.frames.length, 1)
assert.equal(pressureExtraction.buffer.length, 0)

const thresholdFrames = []
for (let index = 0; index < 20; index++) {
  thresholdFrames.push({
    phase: 'rest',
    values: Array.from({ length: 15 }, (_, channel) => 1000 + channel * 10 + (index % 3))
  })
}
for (let index = 0; index < 20; index++) {
  const values = Array.from(
    { length: 15 },
    (_, channel) => 1000 + channel * 10 + (index % 3)
  )
  values[0] += 900
  thresholdFrames.push({ phase: 'press', values })
}
const learnedThreshold = calculateTouchThreshold(thresholdFrames, 0)
assert.ok(learnedThreshold.threshold > 0)
assert.ok(learnedThreshold.threshold < learnedThreshold.pressMedian)
assert.equal(learnedThreshold.strongestIndex, 0)
assert.equal(learnedThreshold.quality, 'good')

const lowResponseFrames = []
for (let index = 0; index < 20; index++) {
  lowResponseFrames.push({
    phase: 'rest',
    values: Array(15).fill(100)
  })
}
for (let index = 0; index < 20; index++) {
  const values = Array(15).fill(100)
  values[0] = 101
  lowResponseFrames.push({ phase: 'press', values })
}
const lowResponseThreshold = calculateTouchThreshold(lowResponseFrames, 0)
assert.equal(lowResponseThreshold.threshold, 1)
assert.equal(lowResponseThreshold.releaseThreshold, 0)

const sparseResponseFrames = []
for (let index = 0; index < 20; index++) {
  sparseResponseFrames.push({ phase: 'rest', values: Array(15).fill(200) })
}
for (let index = 0; index < 20; index++) {
  const values = Array(15).fill(200)
  if (index < 5) values[0] = 202
  sparseResponseFrames.push({ phase: 'press', values })
}
const sparseThreshold = calculateTouchThreshold(sparseResponseFrames, 0)
assert.ok(sparseThreshold.threshold > 0)
assert.equal(sparseThreshold.quality, 'fair')

const noResponseFrames = []
for (let index = 0; index < 20; index++) {
  noResponseFrames.push({ phase: 'rest', values: Array(15).fill(300) })
  noResponseFrames.push({ phase: 'press', values: Array(15).fill(300) })
}
assert.throws(
  () => calculateTouchThreshold(noResponseFrames, 0),
  /目标位点响应不足/
)

const timedFrames = [
  { timestamp: 0, values: Array(15).fill(100) },
  { timestamp: 1000, values: Array(15).fill(110) },
  { timestamp: 3000, values: Array(15).fill(110) }
]
const timedMeans = timeWeightedChannelMeans(timedFrames)
assert.ok(Math.abs(timedMeans[0] - 108.333333) < 0.001)
const singlePressThreshold = calculateSinglePressThreshold({
  targetIndex: 2,
  baselineValues: Array(15).fill(100),
  noiseValues: Array(15).fill(1),
  pressAverage: Array(15).fill(100).map((value, index) => index === 2 ? 580 : value)
})
assert.equal(singlePressThreshold.threshold, 480)
assert.equal(singlePressThreshold.releaseThreshold, 312)
assert.equal(singlePressThreshold.strongestIndex, 2)

const thresholdState = createEmptyTouchThresholdState()
thresholdState.channels[0] = {
  ...thresholdState.channels[0],
  ...learnedThreshold
}
assert.equal(
  normalizeTouchThresholdState(thresholdState).channels[0].threshold,
  learnedThreshold.threshold
)

const legacyThresholdState = {
  version: 1,
  scale: 0.8,
  updatedAt: '2026-01-02T00:00:00.000Z',
  baselineValues: Array.from({ length: 15 }, (_, index) => (index + 1) * 10),
  noiseValues: Array.from({ length: 15 }, (_, index) => index + 1),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: (index + 1) * 10,
    threshold: 1000 + index,
    releaseThreshold: 650 + index,
    pressMedian: 1000 + index,
    averageRaw: 1200 + index,
    averageDelta: 1000 + index,
    restP95: 0,
    noiseSigma: 0.5,
    quality: 'good',
    sampleCount: 1,
    capturedAt: '2026-01-02T00:00:00.000Z'
  }))
}
const migratedThresholds =
  normalizeTouchThresholdState(legacyThresholdState)
assert.equal(migratedThresholds.version, 9)
assert.equal(migratedThresholds.scale, 0.8)
assert.equal(migratedThresholds.baselineValues[0], 10)
assert.equal(migratedThresholds.noiseValues[0], 1)
assert.equal(migratedThresholds.baselineValues[14], 150)
assert.equal(
  migratedThresholds.channels.find((channel) => channel.id === 'A01').threshold,
  1000
)
assert.equal(
  migratedThresholds.channels.find((channel) => channel.id === 'A15').threshold,
  1014
)
assert.equal(migratedThresholds.channels[0].id, 'A01')
assert.equal(migratedThresholds.channels[14].id, 'A15')
assert.equal(
  normalizeTouchThresholdState(migratedThresholds).channels[0].threshold,
  1000
)
const version2ThresholdState = {
  version: 2,
  scale: 0.7,
  baselineValues: version2OrderedValues,
  noiseValues: version2OrderedValues,
  channels: version2OrderedValues.map((value, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: value,
    threshold: 2000 + index
  }))
}
const remigratedThresholds =
  normalizeTouchThresholdState(version2ThresholdState)
assert.equal(remigratedThresholds.version, 9)
assert.equal(remigratedThresholds.scale, 0.7)
assert.equal(remigratedThresholds.baselineValues[0], 1300)
assert.equal(remigratedThresholds.baselineValues[14], 300)
assert.equal(
  remigratedThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  2012
)
assert.equal(
  remigratedThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  2002
)
const version3ThresholdState = {
  version: 3,
  scale: 0.9,
  baselineValues: Array.from({ length: 15 }, (_, index) => 3000 + index),
  noiseValues: Array.from({ length: 15 }, (_, index) => 30 + index),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: 3000 + index,
    threshold: 4000 + index
  }))
}
const reversedThresholds =
  normalizeTouchThresholdState(version3ThresholdState)
assert.equal(reversedThresholds.version, 9)
assert.equal(reversedThresholds.baselineValues[0], 3014)
assert.equal(reversedThresholds.baselineValues[14], 3000)
assert.equal(
  reversedThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  4014
)
assert.equal(
  reversedThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  4000
)
const version4ThresholdState = {
  version: 4,
  scale: 1.1,
  baselineValues: Array.from({ length: 15 }, (_, index) => 5000 + index),
  noiseValues: Array.from({ length: 15 }, (_, index) => 50 + index),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: 5000 + index,
    threshold: 6000 + index
  }))
}
const xOrderedThresholds =
  normalizeTouchThresholdState(version4ThresholdState)
assert.equal(xOrderedThresholds.version, 9)
assert.equal(xOrderedThresholds.baselineValues[0], 5000)
assert.equal(xOrderedThresholds.baselineValues[14], 5014)
assert.equal(
  xOrderedThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  6000
)
assert.equal(
  xOrderedThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  6014
)
const version5ThresholdState = {
  version: 5,
  scale: 1.2,
  baselineValues: Array.from({ length: 15 }, (_, index) => 7000 + index),
  noiseValues: Array.from({ length: 15 }, (_, index) => 70 + index),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: 7000 + index,
    threshold: 8000 + index
  }))
}
const uOrderedThresholds =
  normalizeTouchThresholdState(version5ThresholdState)
assert.equal(uOrderedThresholds.version, 9)
assert.equal(uOrderedThresholds.baselineValues[0], 7012)
assert.equal(uOrderedThresholds.baselineValues[14], 7002)
assert.equal(
  uOrderedThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  8012
)
assert.equal(
  uOrderedThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  8002
)
const version6ThresholdState = {
  version: 6,
  scale: 1.3,
  baselineValues: Array.from({ length: 15 }, (_, index) => 8000 + index),
  noiseValues: Array.from({ length: 15 }, (_, index) => 80 + index),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: 8000 + index,
    threshold: 9000 + index
  }))
}
const mirroredThresholds =
  normalizeTouchThresholdState(version6ThresholdState)
assert.equal(mirroredThresholds.version, 9)
assert.equal(mirroredThresholds.baselineValues[0], 8014)
assert.equal(mirroredThresholds.baselineValues[14], 8000)
assert.equal(
  mirroredThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  9014
)
assert.equal(
  mirroredThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  9000
)
const version7ThresholdState = {
  version: 7,
  scale: 1.4,
  baselineValues: Array.from({ length: 15 }, (_, index) => 9000 + index),
  noiseValues: Array.from({ length: 15 }, (_, index) => 90 + index),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: 9000 + index,
    threshold: 10000 + index
  }))
}
const finalMirrorThresholds =
  normalizeTouchThresholdState(version7ThresholdState)
assert.equal(finalMirrorThresholds.version, 9)
assert.equal(finalMirrorThresholds.baselineValues[0], 9000)
assert.equal(finalMirrorThresholds.baselineValues[14], 9014)
assert.equal(
  finalMirrorThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  10000
)
assert.equal(
  finalMirrorThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  10014
)
const version8ThresholdState = {
  version: 8,
  scale: 1.5,
  baselineValues: Array.from({ length: 15 }, (_, index) => 10000 + index),
  noiseValues: Array.from({ length: 15 }, (_, index) => 100 + index),
  channels: Array.from({ length: 15 }, (_, index) => ({
    id: `A${String(index + 1).padStart(2, '0')}`,
    baseline: 10000 + index,
    threshold: 11000 + index
  }))
}
const originalOrderThresholds =
  normalizeTouchThresholdState(version8ThresholdState)
assert.equal(originalOrderThresholds.version, 9)
assert.equal(originalOrderThresholds.baselineValues[0], 10002)
assert.equal(originalOrderThresholds.baselineValues[14], 10012)
assert.equal(
  originalOrderThresholds.channels.find((channel) => channel.id === 'A01')
    .threshold,
  11002
)
assert.equal(
  originalOrderThresholds.channels.find((channel) => channel.id === 'A15')
    .threshold,
  11012
)
const emptyLegacyChannels = ELECTRODE_LAYOUT.map((channel) => ({
  id: channel.legacyId,
  threshold: null
}))
assert.equal(
  normalizeTouchThresholdState({
    version: 1,
    channels: emptyLegacyChannels
  }).channels.some((channel) => Number.isFinite(channel.threshold)),
  false
)

console.log('基础协议、通道锁存、答案匹配、压力计、压力校准和触诊阈值验证通过。')
