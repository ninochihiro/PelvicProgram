<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  CHANNEL_COUNT as PROTOCOL_CHANNEL_COUNT,
  parseSerialFrame
} from '../utils/serialProtocol'
import { createSerialSocket, listSerialPorts } from '../utils/serialSocket'
import {
  authState,
  getTouchThresholdConfig,
  saveTouchThresholdConfig
} from '../utils/authClient'
import {
  CALIBRATION_STORAGE_KEY,
  PRESSURE_PRESETS,
  PRESSURE_UNIT,
  SENSOR_CHANNEL_IDS,
  createEmptyCalibration,
  hasUsableCalibration,
  interpolatePressure,
  normalizeCalibrationData,
  sortCalibrationPoints,
  validateCalibrationPoints
} from '../utils/pressureCalibration'
import { PRESSURE_GAUGE_BAUD } from '../utils/pressureGauge'
import {
  TOUCH_THRESHOLD_STORAGE_KEY,
  TOUCH_THRESHOLD_VERSION,
  calculateTouchThreshold,
  createEmptyTouchThresholdState,
  normalizeTouchThresholdState
} from '../utils/touchThresholdCalibration'
import {
  calculateSinglePressThreshold,
  estimateChannelNoise,
  timeWeightedChannelMeans
} from '../utils/sequentialThresholdCalibration'
import {
  ELECTRODE_LAYOUT,
  remapLegacyChannelArray
} from '../data/electrodeLayout'

const CHANNEL_COUNT = PROTOCOL_CHANNEL_COUNT
const ADC_MAX = 16383
const ADC_DISPLAY_MAX = 10000
const THRESHOLD_BASELINE_DURATION_MS = 10000
const THRESHOLD_PRESS_DURATION_MS = 5000

const channelMeta = ELECTRODE_LAYOUT
const channelDisplayOrder = channelMeta
  .map((channel, channelIndex) => ({ ...channel, channelIndex }))

const channelValues = ref(Array(CHANNEL_COUNT).fill(null))
const rawValueFrame = ref(Array(CHANNEL_COUNT).fill(null))
const baselineValues = ref(Array(CHANNEL_COUNT).fill(0))
const baselineHistory = ref([])
const baselineCapturedAt = ref(null)
const rawTokens = ref([])
const rangeMask = ref(null)
const selectedIndex = ref(0)
const lineBuffer = ref('')
const baudRate = ref('460800')
const connectionMode = ref('service')
const availablePorts = ref([])
const selectedPortPath = ref('')
const connectionState = ref('idle')
const connectionMessage = ref('点击连接串口')
const serviceReady = ref(false)
const activeTransport = ref('')
const totalFrames = ref(0)
const framesPerSecond = ref(0)
const lastFrameAt = ref(null)
const serialDataFresh = ref(false)
const demoRunning = ref(false)
const showCalibration = ref(false)
const calibrationMode = ref('threshold')
const calibration = ref(createEmptyCalibration())
const touchThresholds = ref(createEmptyTouchThresholdState())
const thresholdActive = ref(Array(CHANNEL_COUNT).fill(false))
const thresholdDeltas = ref(Array(CHANNEL_COUNT).fill(null))
const thresholdChartBaseline = ref(Array(CHANNEL_COUNT).fill(null))
const thresholdSaveState = ref('idle')
const thresholdSavedAt = ref(null)
const currentDetectedChannel = ref(null)
const selectedCalibrationIndex = ref(0)
const calibrationPressure = ref('5')
const calibrationNotice = reactive({
  tone: 'info',
  text: ''
})
const captureState = reactive({
  running: false,
  samples: [],
  pressures: []
})
const importFileInput = ref(null)
const thresholdImportFileInput = ref(null)
const thresholdLearning = reactive({
  sessionActive: false,
  sequenceActive: false,
  singleChannelMode: false,
  running: false,
  channelIndex: 0,
  phaseKind: 'idle',
  phaseLabel: '',
  remainingMs: 0,
  progress: 0,
  result: null,
  diagnostics: null,
  phase: 'idle',
  sessionBaselineReady: false,
  captureFrames: [],
  pressAverages: [],
  captureDeadline: 0
})
const pressurePortPath = ref('')
const pressureConnectionState = ref('idle')
const pressureConnectionMessage = ref('压力计未连接')
const pressureValue = ref(null)
const pressureFrameCount = ref(0)
const pressureLastFrameAt = ref(null)

const serialSupported =
  typeof navigator !== 'undefined' && 'serial' in navigator

let serialPort = null
let serialReader = null
let keepReading = false
let serviceSocket = null
let serviceConnectPromise = null
let serviceReconnectTimer = null
let serviceReconnectEnabled = true
let demoTimer = null
let fpsTimer = null
let frameTimes = []
let calibrationCaptureTimer = null
let pressureDataTimer = null
let thresholdLearningInterval = null
let thresholdSampleTimer = null
let touchThresholdSaveTimer = null

const connected = computed(
  () => connectionState.value === 'connected' || connectionState.value === 'demo'
)
const pressureConnected = computed(
  () => pressureConnectionState.value === 'connected'
)

const values = computed(() =>
  channelValues.value.map((value) =>
    Number.isFinite(value) ? value : null
  )
)

const validValues = computed(() =>
  values.value.filter((value) => Number.isFinite(value))
)

const stats = computed(() => {
  if (!validValues.value.length) {
    return { min: null, max: null, active: 0 }
  }

  return {
    min: Math.min(...validValues.value),
    max: Math.max(...validValues.value),
    active: thresholdActive.value.filter(Boolean).length
  }
})

const rangeMaskLabel = computed(() =>
  rangeMask.value === null
    ? '未提供量程位图'
    : `0x${rangeMask.value.toString(16).toUpperCase()}`
)

const latestRawLine = computed(() =>
  rawTokens.value.length ? rawTokens.value.join(',') : '等待传感器数据...'
)

const selectedCalibrationChannel = computed(
  () => calibration.value.channels[selectedCalibrationIndex.value]
)

const selectedCalibrationPoints = computed(
  () => selectedCalibrationChannel.value?.points ?? []
)

const calibratedChannelCount = computed(
  () =>
    calibration.value.channels.filter((channel) =>
      hasUsableCalibration(channel.points)
    ).length
)

const livePressureValues = computed(() =>
  rawValueFrame.value.map((adc, index) => {
    const channel = calibration.value.channels[index]
    if (!channel || !hasUsableCalibration(channel.points)) return null
    return interpolatePressure(adc, channel.points)
  })
)

const selectedRawAdc = computed(() => rawValueFrame.value[selectedCalibrationIndex.value])
const selectedLivePressure = computed(
  () => livePressureValues.value[selectedCalibrationIndex.value]
)
const selectedCalibrationValidation = computed(() =>
  validateCalibrationPoints(selectedCalibrationPoints.value)
)
const selectedThresholdChannel = computed(
  () => touchThresholds.value.channels[selectedCalibrationIndex.value]
)
const learnedThresholdCount = computed(
  () =>
    touchThresholds.value.channels.filter((channel) =>
      Number.isFinite(channel.threshold)
    ).length
)
const allThresholdsLearned = computed(
  () =>
    learnedThresholdCount.value === CHANNEL_COUNT &&
    (!thresholdLearning.sequenceActive || thresholdLearning.phase === 'complete')
)
const canCalibrateThresholds = computed(
  () => authState.user?.role === 'admin'
)
const selectedThresholdInfo = computed(() => {
  const channel = selectedThresholdChannel.value
  if (!Number.isFinite(channel?.threshold)) return null
  return {
    threshold: Math.max(
      1,
      Math.round(channel.threshold * touchThresholds.value.scale)
    ),
    releaseThreshold: Math.max(
      0,
      Math.round(channel.releaseThreshold * touchThresholds.value.scale)
    )
  }
})
const thresholdChartBars = computed(() => {
  const rawValues = rawValueFrame.value
  const deltas = rawValues.map((value, index) => {
    const baseline = thresholdChartBaseline.value[index]
    return Number.isFinite(value) && Number.isFinite(baseline)
      ? value - baseline
      : 0
  })

  return channelDisplayOrder.map(({ channelIndex, ...channel }) => ({
    ...channel,
    rawValue: rawValues[channelIndex],
    delta: deltas[channelIndex],
    height: clamp((rawValues[channelIndex] / ADC_DISPLAY_MAX) * 100, 0, 100),
    target: channelIndex === selectedCalibrationIndex.value
  }))
})
const thresholdProgressDisplay = computed(() =>
  thresholdLearning.running
    ? thresholdLearning.progress
    : Math.round((learnedThresholdCount.value / CHANNEL_COUNT) * 100)
)
const thresholdSaveLabel = computed(() => {
  if (!canCalibrateThresholds.value) return '服务主机只读配置'
  if (thresholdSaveState.value === 'saving') return '正在保存...'
  if (thresholdSaveState.value === 'error') return '保存失败'
  if (thresholdSaveState.value === 'saved') {
    return thresholdSavedAt.value
      ? `已保存 ${thresholdSavedAt.value.toLocaleTimeString('zh-CN')}`
      : '已保存'
  }
  return '尚未修改'
})
const thresholdScale = computed({
  get: () => touchThresholds.value.scale,
  set: (value) => {
    if (!canCalibrateThresholds.value) return
    touchThresholds.value = {
      ...touchThresholds.value,
      scale: Math.min(2, Math.max(0.5, Number(value)))
    }
    persistTouchThresholds()
  }
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizedValue(value) {
  if (!Number.isFinite(value)) return 0
  return clamp(value / ADC_DISPLAY_MAX, 0, 1)
}

function accentColor(value) {
  if (!Number.isFinite(value)) return '#708090'
  const hue = 220 - normalizedValue(value) * 220
  return `hsl(${hue.toFixed(0)} 88% 57%)`
}

function hotspotStyle(channel) {
  const index = channelMeta.indexOf(channel)
  const value = values.value[index]
  const heat = normalizedValue(value)
  const active = thresholdActive.value[index]

  return {
    left: `${channel.x}%`,
    top: `${channel.y}%`,
    '--accent': active ? '#ef5964' : accentColor(value),
    '--halo-size': `${active ? 76 : 38 + heat * 52}px`,
    '--halo-opacity': `${active ? 0.95 : 0.16 + heat * 0.66}`,
    '--halo-blur': `${active ? 34 : 12 + heat * 28}px`
  }
}

function barStyle(index) {
  const value = values.value[index]
  const model = touchThresholds.value.channels[index]
  const active = thresholdActive.value[index]
  const thresholdAbsolute = Number.isFinite(model?.threshold)
    ? model.baseline + model.threshold * touchThresholds.value.scale
    : null

  return {
    '--accent': active ? '#ef5964' : accentColor(value),
    '--heat': normalizedValue(value),
    '--threshold-heat': Number.isFinite(thresholdAbsolute)
      ? normalizedValue(thresholdAbsolute)
      : 0,
    '--threshold-visible': Number.isFinite(thresholdAbsolute) ? 1 : 0
  }
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? Math.round(value).toLocaleString('zh-CN')
    : '—'
}

function formatPressure(value) {
  return Number.isFinite(value)
    ? `${value.toFixed(1)} ${PRESSURE_UNIT}`
    : '未校准'
}

function setCalibrationNotice(text, tone = 'info') {
  calibrationNotice.text = text
  calibrationNotice.tone = tone
}

function persistCalibration() {
  window.localStorage.setItem(
    CALIBRATION_STORAGE_KEY,
    JSON.stringify(calibration.value)
  )
}

function loadSavedCalibration() {
  try {
    const stored = window.localStorage.getItem(CALIBRATION_STORAGE_KEY)
    if (stored) {
      calibration.value = normalizeCalibrationData(JSON.parse(stored))
      window.localStorage.setItem(
        CALIBRATION_STORAGE_KEY,
        JSON.stringify(calibration.value)
      )
    }
  } catch {
    setCalibrationNotice('本地校准数据读取失败，将从空白数据开始。', 'error')
  }
}

function persistTouchThresholds({ immediate = false } = {}) {
  window.localStorage.setItem(
    TOUCH_THRESHOLD_STORAGE_KEY,
    JSON.stringify(touchThresholds.value)
  )
  if (!canCalibrateThresholds.value) return Promise.resolve()

  clearTimeout(touchThresholdSaveTimer)
  thresholdSaveState.value = 'saving'

  const save = async () => {
    try {
      await saveTouchThresholdConfig(touchThresholds.value)
      thresholdSaveState.value = 'saved'
      thresholdSavedAt.value = new Date()
      return true
    } catch (error) {
      thresholdSaveState.value = 'error'
      setCalibrationNotice(`阈值保存到服务主机失败：${error.message}`, 'error')
      return false
    }
  }

  if (immediate) {
    touchThresholdSaveTimer = null
    return save()
  }

  touchThresholdSaveTimer = window.setTimeout(() => {
    touchThresholdSaveTimer = null
    save()
  }, 350)
  return Promise.resolve()
}

async function loadSavedTouchThresholds() {
  try {
    const stored = window.localStorage.getItem(TOUCH_THRESHOLD_STORAGE_KEY)
    if (stored) {
      touchThresholds.value = normalizeTouchThresholdState(JSON.parse(stored))
      window.localStorage.setItem(
        TOUCH_THRESHOLD_STORAGE_KEY,
        JSON.stringify(touchThresholds.value)
      )
    }
  } catch {
    setCalibrationNotice('本地触诊阈值读取失败，将从空白数据开始。', 'error')
  }

  try {
    const payload = await getTouchThresholdConfig()
    if (payload?.config) {
      const normalized = normalizeTouchThresholdState(payload.config)
      touchThresholds.value = normalized
      thresholdSaveState.value = 'saved'
      thresholdSavedAt.value = normalized.updatedAt
        ? new Date(normalized.updatedAt)
        : null
      window.localStorage.setItem(
        TOUCH_THRESHOLD_STORAGE_KEY,
        JSON.stringify(normalized)
      )
      if (
        Number(payload.config.version) !== TOUCH_THRESHOLD_VERSION &&
        canCalibrateThresholds.value
      ) {
        const saved = await persistTouchThresholds({ immediate: true })
        if (saved) {
          setCalibrationNotice(
            '旧版阈值已按图片中的 A01～A15 顺序迁移并保存，无需重新采集。',
            'success'
          )
        }
      }
    }
  } catch (error) {
    setCalibrationNotice(`服务主机阈值读取失败：${error.message}`, 'error')
  }
}

function recordThresholdLearningSample(values, timestamp = Date.now()) {
  if (
    !thresholdLearning.running ||
    !['baseline', 'capturing'].includes(thresholdLearning.phase)
  ) {
    return
  }
  if (!values.every(Number.isFinite)) return
  thresholdLearning.captureFrames.push({
    timestamp,
    values: [...values]
  })
}

function updateThresholdActivity(rawSample) {
  if (!allThresholdsLearned.value) {
    resetTouchActivity()
    return
  }

  const nextActive = Array(CHANNEL_COUNT).fill(false)
  const nextDeltas = Array(CHANNEL_COUNT).fill(null)
  let strongest = null

  touchThresholds.value.channels.forEach((model, index) => {
    const raw = rawSample[index]
    if (
      !Number.isFinite(raw) ||
      !Number.isFinite(model.baseline) ||
      !Number.isFinite(model.threshold)
    ) {
      return
    }

    const threshold = Math.max(
      1,
      Math.round(model.threshold * touchThresholds.value.scale)
    )
    const releaseThreshold = Math.max(
      0,
      Math.round(model.releaseThreshold * touchThresholds.value.scale)
    )
    const effectiveReleaseThreshold = Math.max(1, releaseThreshold)
    const delta = raw - model.baseline
    const active = thresholdActive.value[index]
      ? delta >= effectiveReleaseThreshold
      : delta >= threshold

    nextDeltas[index] = delta
    nextActive[index] = active
    if (active) {
      const ratio = delta / threshold
      if (!strongest || ratio > strongest.ratio) {
        strongest = { index, ratio, delta }
      }
    }
  })

  thresholdActive.value = nextActive
  thresholdDeltas.value = nextDeltas
  currentDetectedChannel.value = strongest?.index ?? null
}

function resetTouchActivity() {
  thresholdActive.value = Array(CHANNEL_COUNT).fill(false)
  thresholdDeltas.value = Array(CHANNEL_COUNT).fill(null)
  currentDetectedChannel.value = null
}

function prepareCurrentThresholdPoint(index) {
  thresholdLearning.channelIndex = index
  selectedCalibrationIndex.value = index
  thresholdLearning.phase = 'waiting-capture'
  thresholdLearning.phaseKind = 'idle'
  thresholdLearning.phaseLabel = `请按压 ${SENSOR_CHANNEL_IDS[index]} 后点击记录5秒`
  thresholdLearning.remainingMs = 0
  thresholdLearning.progress = 0
  thresholdLearning.captureFrames = []
  thresholdLearning.pressAverages = []
  thresholdLearning.result = null
  thresholdLearning.diagnostics = null

  thresholdChartBaseline.value = [...rawValueFrame.value]
}

function startThresholdLearning() {
  if (thresholdLearning.sequenceActive) return
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以重新学习触诊阈值。', 'error')
    return
  }
  if (demoRunning.value) {
    setCalibrationNotice('演示数据不能用于真实触诊阈值学习。', 'error')
    return
  }
  if (!rawValueFrame.value.every(Number.isFinite)) {
    setCalibrationNotice('尚未收到完整的15通道串口数据。', 'error')
    return
  }
  if (!serialDataFresh.value) {
    setCalibrationNotice('串口数据已停止更新，请重新连接传感器。', 'error')
    return
  }
  if (!thresholdLearning.sessionBaselineReady) {
    setCalibrationNotice('请先点击“静置清零（10秒）”采集统一基线。', 'error')
    return
  }
  thresholdLearning.sessionActive = true
  thresholdLearning.sequenceActive = true
  thresholdLearning.singleChannelMode = false
  thresholdLearning.running = false
  let firstMissing = touchThresholds.value.channels.findIndex(
    (channel) => !Number.isFinite(channel.threshold)
  )
  if (firstMissing < 0) {
    touchThresholds.value = {
      ...touchThresholds.value,
      updatedAt: new Date().toISOString(),
      channels: createEmptyTouchThresholdState().channels
    }
    persistTouchThresholds({ immediate: true })
    firstMissing = 0
  }
  prepareCurrentThresholdPoint(firstMissing >= 0 ? firstMissing : 0)
  setCalibrationNotice(
    `请按好 ${SENSOR_CHANNEL_IDS[thresholdLearning.channelIndex]}，然后点击“记录当前按压5秒”。`,
    'info'
  )
}

function startSingleChannelRecalibration(index) {
  if (thresholdLearning.sequenceActive || thresholdLearning.running) return
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以重新校准通道阈值。', 'error')
    return
  }
  if (!serialDataFresh.value) {
    setCalibrationNotice('串口数据已停止更新，请重新连接传感器。', 'error')
    return
  }
  if (
    !Number.isFinite(touchThresholds.value.baselineValues[index]) ||
    !Number.isFinite(touchThresholds.value.noiseValues[index])
  ) {
    setCalibrationNotice('当前通道没有统一静置基线，请先执行静置清零10秒。', 'error')
    return
  }

  thresholdLearning.singleChannelMode = true
  thresholdLearning.sessionActive = true
  thresholdLearning.sequenceActive = true
  prepareCurrentThresholdPoint(Number(index))
  setCalibrationNotice(
    `准备重新校准 ${SENSOR_CHANNEL_IDS[index]}。请按好该位点后点击记录5秒。`,
    'info'
  )
}

function startThresholdBaselineCapture() {
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以采集触诊基线。', 'error')
    return
  }
  if (
    thresholdLearning.sequenceActive ||
    thresholdLearning.running ||
    thresholdLearning.phase === 'baseline'
  ) {
    return
  }
  if (demoRunning.value) {
    setCalibrationNotice('演示数据不能用于真实基线采集。', 'error')
    return
  }
  if (!rawValueFrame.value.every(Number.isFinite)) {
    setCalibrationNotice('尚未收到完整的15通道数据。', 'error')
    return
  }
  if (!serialDataFresh.value) {
    setCalibrationNotice('串口数据已停止更新，请重新连接传感器。', 'error')
    return
  }

  clearInterval(thresholdLearningInterval)
  const durationMs = THRESHOLD_BASELINE_DURATION_MS
  const phaseEndsAt = Date.now() + durationMs
  thresholdLearning.phase = 'baseline'
  thresholdLearning.phaseKind = 'rest'
  thresholdLearning.phaseLabel = '请松开全部位点，采集统一静置清零基线'
  thresholdLearning.running = true
  thresholdLearning.captureFrames = []
  thresholdLearning.remainingMs = durationMs
  thresholdLearning.progress = 0
  setCalibrationNotice(
    '正在采集全部15通道的10秒统一静置基线。',
    'info'
  )

  thresholdLearningInterval = window.setInterval(() => {
    const now = Date.now()
    thresholdLearning.remainingMs = Math.max(0, phaseEndsAt - now)
    thresholdLearning.progress = Math.min(
      100,
      Math.round(
        ((durationMs - thresholdLearning.remainingMs) / durationMs) * 100
      )
    )

    if (now >= phaseEndsAt) {
      clearInterval(thresholdLearningInterval)
      finishThresholdBaselineCapture()
    }
  }, 100)
}

function finishThresholdBaselineCapture() {
  thresholdLearning.running = false
  thresholdLearning.progress = 100
  try {
    const measuredBaseline = timeWeightedChannelMeans(
      thresholdLearning.captureFrames
    )
    const measuredNoise = estimateChannelNoise(thresholdLearning.captureFrames)
    const baselineValues = measuredBaseline
    const noiseValues = measuredNoise
    touchThresholds.value = {
      ...touchThresholds.value,
      baselineValues,
      noiseValues,
      channels: createEmptyTouchThresholdState().channels,
      updatedAt: new Date().toISOString()
    }
    thresholdLearning.sessionBaselineReady = true
    thresholdLearning.phase = 'idle'
    thresholdLearning.phaseLabel = ''
    thresholdLearning.phaseKind = 'idle'
    thresholdLearning.captureFrames = []
    persistTouchThresholds({ immediate: true })
    setCalibrationNotice(
      '统一静置清零已完成，旧触诊阈值已清除。请点击“开始 A01～A15 顺序标定”。',
      'success'
    )
  } catch (error) {
    thresholdLearning.phase = 'idle'
    thresholdLearning.phaseLabel = '统一静置采集失败，请重新采集'
    setCalibrationNotice(`静置基线采集失败：${error.message}`, 'error')
  }
}

function processSequentialThresholdSample(values) {
  if (!thresholdLearning.sequenceActive || !values.every(Number.isFinite)) {
    return
  }

  if (thresholdLearning.phase === 'capturing' && thresholdLearning.running) {
    if (Date.now() >= thresholdLearning.captureDeadline) {
      finishSinglePressCapture()
    }
  }
}

function startSinglePressCapture() {
  if (
    !thresholdLearning.sequenceActive ||
    thresholdLearning.running ||
    thresholdLearning.phase !== 'waiting-capture'
  ) {
    return
  }
  if (!rawValueFrame.value.every(Number.isFinite)) {
    setCalibrationNotice('当前没有完整的15通道数据。', 'error')
    return
  }
  if (!serialDataFresh.value) {
    setCalibrationNotice('串口数据已停止更新，请重新连接传感器。', 'error')
    return
  }

  clearInterval(thresholdLearningInterval)
  thresholdLearning.running = true
  thresholdLearning.phase = 'capturing'
  thresholdLearning.phaseKind = 'press'
  thresholdLearning.captureFrames = []
  thresholdLearning.captureDeadline =
    Date.now() + THRESHOLD_PRESS_DURATION_MS
  thresholdLearning.remainingMs = THRESHOLD_PRESS_DURATION_MS
  thresholdLearning.progress = 0

  const channelId = SENSOR_CHANNEL_IDS[thresholdLearning.channelIndex]
  thresholdLearning.phaseLabel = `正在记录 ${channelId} 的5秒时间加权平均ADC`
  setCalibrationNotice(
    `正在记录 ${channelId} 按压后的5秒平均值，请保持当前压力。`,
    'success'
  )

  thresholdLearningInterval = window.setInterval(() => {
    const now = Date.now()
    thresholdLearning.remainingMs = Math.max(
      0,
      thresholdLearning.captureDeadline - now
    )
    thresholdLearning.progress = Math.min(
      100,
      Math.round(
        ((THRESHOLD_PRESS_DURATION_MS - thresholdLearning.remainingMs) /
          THRESHOLD_PRESS_DURATION_MS) *
          100
      )
    )
    if (now >= thresholdLearning.captureDeadline) {
      finishSinglePressCapture()
    }
  }, 100)
}

function finishSinglePressCapture() {
  if (
    thresholdLearning.phase !== 'capturing' ||
    !thresholdLearning.running
  ) {
    return
  }

  clearInterval(thresholdLearningInterval)
  thresholdLearning.running = false
  try {
    const average = timeWeightedChannelMeans(
      thresholdLearning.captureFrames
    )
    thresholdLearning.pressAverages = [average]
    thresholdLearning.captureFrames = []
    thresholdLearning.remainingMs = 0
    thresholdLearning.progress = 100
    completeSequentialPointCalibration()
  } catch (error) {
    thresholdLearning.phase = 'waiting-capture'
    thresholdLearning.phaseKind = 'idle'
    thresholdLearning.phaseLabel = '请按压目标位点后重新点击记录'
    thresholdLearning.captureFrames = []
    setCalibrationNotice(`记录失败：${error.message}，请重新按压并记录。`, 'error')
  }
}

function completeSequentialPointCalibration() {
  try {
    const targetIndex = thresholdLearning.channelIndex
    const result = calculateSinglePressThreshold({
      targetIndex,
      baselineValues: touchThresholds.value.baselineValues,
      noiseValues: touchThresholds.value.noiseValues,
      pressAverage: thresholdLearning.pressAverages[0]
    })

    const channels = touchThresholds.value.channels.map((channel, index) =>
      index === targetIndex
        ? {
            ...channel,
            ...result,
            capturedAt: new Date().toISOString()
          }
        : channel
    )
    touchThresholds.value = {
      ...touchThresholds.value,
      updatedAt: new Date().toISOString(),
      channels
    }
    thresholdLearning.result = result
    thresholdLearning.diagnostics = result
    persistTouchThresholds({ immediate: true })

    const targetChannel = SENSOR_CHANNEL_IDS[thresholdLearning.channelIndex]
    const strongestChannel = SENSOR_CHANNEL_IDS[result.strongestIndex]
    if (result.strongestIndex !== thresholdLearning.channelIndex) {
      setCalibrationNotice(
        `${targetChannel} 阈值已记录，但最强响应出现在 ${strongestChannel}，请检查按压位置。`,
        'error'
      )
    } else {
      setCalibrationNotice(
        `${targetChannel} 已完成：静置值 ${result.baseline}，按压平均值 ${result.averageRaw}。请确认是否重新标定。`,
        result.quality === 'poor' ? 'error' : 'success'
      )
    }
    thresholdLearning.phase = 'review'
    thresholdLearning.phaseKind = 'idle'
    thresholdLearning.phaseLabel = `请确认 ${targetChannel} 标定结果`
  } catch (error) {
    thresholdLearning.phase = 'waiting-capture'
    thresholdLearning.phaseKind = 'idle'
    thresholdLearning.phaseLabel = `请重新按压 ${SENSOR_CHANNEL_IDS[thresholdLearning.channelIndex]}后点击记录`
    thresholdLearning.running = false
    thresholdLearning.result = null
    thresholdLearning.diagnostics = error.diagnostics ?? null
    const details = error.diagnostics
      ? `（5秒平均ADC ${error.diagnostics.averageRaw ?? '—'}，基线 ${error.diagnostics.baseline ?? '—'}，平均增量 ${error.diagnostics.averageDelta ?? '—'}，噪声 ${error.diagnostics.noiseSigma ?? '—'}）`
      : ''
    setCalibrationNotice(
      `阈值学习失败：${error.message}${details}`,
      'error'
    )
  }
}

function confirmCurrentThresholdPoint() {
  if (thresholdLearning.phase !== 'review') return
  const currentIndex = thresholdLearning.channelIndex
  if (thresholdLearning.singleChannelMode) {
    thresholdLearning.sequenceActive = false
    thresholdLearning.sessionActive = false
    thresholdLearning.singleChannelMode = false
    thresholdLearning.phase = 'complete'
    thresholdLearning.phaseKind = 'idle'
    thresholdLearning.phaseLabel = `${SENSOR_CHANNEL_IDS[currentIndex]} 阈值已更新`
    setCalibrationNotice(
      `${SENSOR_CHANNEL_IDS[currentIndex]} 的新阈值已保存并立即生效。`,
      'success'
    )
    return
  }
  const channels = touchThresholds.value.channels
  const nextIndex = channels.findIndex(
    (channel, index) =>
      index > currentIndex && !Number.isFinite(channel.threshold)
  )
  const fallbackNext = channels.findIndex(
    (channel) => !Number.isFinite(channel.threshold)
  )
  const actualNext = nextIndex >= 0 ? nextIndex : fallbackNext

  if (actualNext < 0) {
    thresholdLearning.sequenceActive = false
    thresholdLearning.sessionActive = false
      thresholdLearning.phase = 'complete'
    thresholdLearning.phaseKind = 'idle'
      thresholdLearning.phaseLabel = '全部位点标定完成'
      thresholdLearning.sessionBaselineReady = false
    setCalibrationNotice(
      'A01～A15全部完成标定，触诊阈值已应用到电极压力分布图。',
      'success'
    )
    return
  }

  prepareCurrentThresholdPoint(actualNext)
  thresholdChartBaseline.value = [...rawValueFrame.value]
  setCalibrationNotice(
    `已确认 ${SENSOR_CHANNEL_IDS[currentIndex]}。请按好 ${SENSOR_CHANNEL_IDS[actualNext]}，然后点击记录5秒。`,
    'info'
  )
}

function recalibrateCurrentThresholdPoint() {
  if (thresholdLearning.phase !== 'review') return
  const currentIndex = thresholdLearning.channelIndex
  prepareCurrentThresholdPoint(currentIndex)
  setCalibrationNotice(
    `已选择重新标定 ${SENSOR_CHANNEL_IDS[currentIndex]}。请按好该位点后点击记录5秒。`,
    'info'
  )
}

function stopThresholdLearning() {
  clearInterval(thresholdLearningInterval)
  thresholdLearning.running = false
  thresholdLearning.sessionActive = false
  thresholdLearning.sequenceActive = false
  thresholdLearning.singleChannelMode = false
  thresholdLearning.sessionBaselineReady = false
  thresholdLearning.phaseKind = 'idle'
  thresholdLearning.phase = 'idle'
  thresholdLearning.phaseLabel = ''
  thresholdLearning.remainingMs = 0
  thresholdLearning.captureFrames = []
  thresholdLearning.pressAverages = []
  setCalibrationNotice('本次阈值学习已取消。', 'info')
}

function clearSelectedThreshold() {
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以清除触诊阈值。', 'error')
    return
  }
  const channel = selectedThresholdChannel.value
  if (!Number.isFinite(channel.threshold)) return
  if (!window.confirm(`确定清除 ${channel.id} 的触诊阈值吗？`)) return
  touchThresholds.value = {
    ...touchThresholds.value,
    updatedAt: new Date().toISOString(),
    channels: touchThresholds.value.channels.map((item, index) =>
      index === selectedCalibrationIndex.value
        ? createEmptyTouchThresholdState().channels[index]
        : item
    )
  }
  persistTouchThresholds({ immediate: true })
  thresholdLearning.result = null
  thresholdLearning.diagnostics = null
  setCalibrationNotice(`${channel.id} 的触诊阈值已清除。`, 'info')
}

function clearAllTouchThresholds() {
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以清除触诊阈值。', 'error')
    return
  }
  if (!learnedThresholdCount.value) return
  if (!window.confirm('确定清空全部15个位点的触诊阈值吗？')) return
  touchThresholds.value = createEmptyTouchThresholdState()
  thresholdLearning.result = null
  thresholdLearning.diagnostics = null
  persistTouchThresholds({ immediate: true })
  setCalibrationNotice('全部触诊阈值已清除，可以重新学习。', 'info')
}

async function saveTouchThresholdsManually() {
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以保存触诊阈值。', 'error')
    return
  }
  if (thresholdLearning.running || thresholdLearning.sequenceActive) {
    setCalibrationNotice('请先完成或取消当前阈值采集，再保存数据。', 'error')
    return
  }
  if (!learnedThresholdCount.value) {
    setCalibrationNotice('当前没有可保存的触诊阈值。', 'error')
    return
  }

  touchThresholds.value = {
    ...touchThresholds.value,
    updatedAt: new Date().toISOString()
  }
  const saved = await persistTouchThresholds({ immediate: true })
  if (saved) {
    setCalibrationNotice(
      `已保存 ${learnedThresholdCount.value} 个通道的阈值，刷新页面后仍会保留。`,
      'success'
    )
  }
}

function exportTouchThresholds() {
  const blob = new Blob([JSON.stringify(touchThresholds.value, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `mpps-touch-thresholds-${new Date()
    .toISOString()
    .slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  setCalibrationNotice('触诊阈值文件已导出。', 'success')
}

function openThresholdImport() {
  thresholdImportFileInput.value?.click()
}

async function importTouchThresholds(event) {
  if (!canCalibrateThresholds.value) {
    setCalibrationNotice('只有管理员可以导入触诊阈值。', 'error')
    event.target.value = ''
    return
  }
  const file = event.target.files?.[0]
  if (!file) return
  try {
    if (thresholdLearning.running || thresholdLearning.sequenceActive) {
      throw new Error('请先完成或取消当前阈值采集')
    }
    const imported = normalizeTouchThresholdState(
      JSON.parse(await file.text())
    )
    const importedCount = imported.channels.filter(
      (channel) => Number.isFinite(channel.threshold) && channel.threshold > 0
    ).length
    if (!importedCount) {
      throw new Error('文件中没有有效的触诊阈值')
    }
    if (
      learnedThresholdCount.value &&
      !window.confirm(
        `导入将覆盖当前 ${learnedThresholdCount.value} 个通道的阈值，是否继续？`
      )
    ) {
      return
    }
    touchThresholds.value = {
      ...imported,
      updatedAt: new Date().toISOString()
    }
    thresholdLearning.result = null
    thresholdLearning.diagnostics = null
    const saved = await persistTouchThresholds({ immediate: true })
    if (saved) {
      setCalibrationNotice(
        `阈值文件导入成功，共恢复 ${importedCount} 个通道。`,
        'success'
      )
    }
  } catch (error) {
    setCalibrationNotice(`阈值导入失败：${error.message}`, 'error')
  } finally {
    event.target.value = ''
  }
}

function selectCalibrationChannel(index) {
  if (
    captureState.running ||
    thresholdLearning.running ||
    thresholdLearning.sessionActive
  ) {
    return
  }
  selectedCalibrationIndex.value = Number(index)
  thresholdLearning.result = null
  thresholdLearning.diagnostics = null
  setCalibrationNotice('')
}

function recordCalibrationSample(adc) {
  if (!captureState.running || !Number.isFinite(adc)) return
  captureState.samples.push(adc)
}

function recordPressureSample(forceN) {
  if (!captureState.running || !Number.isFinite(forceN)) return
  captureState.pressures.push(forceN)
}

function startCalibrationCapture() {
  if (captureState.running) return
  if (thresholdLearning.running) {
    setCalibrationNotice('请先完成或取消当前触诊阈值学习。', 'error')
    return
  }
  if (demoRunning.value) {
    setCalibrationNotice('演示数据不能用于真实压力校准。', 'error')
    return
  }

  const manualPressure = Number(calibrationPressure.value)
  if (
    !pressureConnected.value &&
    (!Number.isFinite(manualPressure) || manualPressure < 0)
  ) {
    setCalibrationNotice('请输入有效的压力值。', 'error')
    return
  }
  if (
    pressureConnected.value &&
    (!Number.isFinite(pressureValue.value) || pressureValue.value < 0)
  ) {
    setCalibrationNotice('压力计尚未收到有效非负压力数据。', 'error')
    return
  }
  if (!Number.isFinite(rawValueFrame.value[selectedCalibrationIndex.value])) {
    setCalibrationNotice('尚未收到当前通道的串口数据。', 'error')
    return
  }

  captureState.samples = []
  captureState.pressures = []
  captureState.running = true
  setCalibrationNotice(
    pressureConnected.value
      ? '正在同步采集压力计和 ADC 数据，请保持压力稳定约 0.8 秒。'
      : `正在采集 ${manualPressure.toFixed(1)} N 的 ADC，请保持压力稳定约 0.8 秒。`,
    'info'
  )

  clearTimeout(calibrationCaptureTimer)
  calibrationCaptureTimer = window.setTimeout(
    () => finishCalibrationCapture(manualPressure),
    800
  )
}

function finishCalibrationCapture(manualPressure) {
  const samples = captureState.samples.filter(Number.isFinite)
  const pressureSamples = captureState.pressures.filter(Number.isFinite)
  captureState.running = false
  captureState.samples = []
  captureState.pressures = []

  if (samples.length < 5) {
    setCalibrationNotice('采样数量不足，请确认串口在线后重试。', 'error')
    return
  }

  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const spread = Math.max(...samples) - Math.min(...samples)
  let pressure = manualPressure
  let pressureSpread = 0

  if (pressureConnected.value) {
    if (pressureSamples.length < 3) {
      setCalibrationNotice('压力计采样数量不足，请检查压力计连接后重试。', 'error')
      return
    }
    pressure =
      pressureSamples.reduce((sum, value) => sum + value, 0) /
      pressureSamples.length
    pressureSpread =
      Math.max(...pressureSamples) - Math.min(...pressureSamples)
  }

  pressure = Math.round(pressure * 10) / 10
  if (pressure < 0) {
    setCalibrationNotice('压力值不能为负数，请对压力计清零后重试。', 'error')
    return
  }
  const point = {
    pressureN: pressure,
    adc: Math.round(average),
    spread: Math.round(spread),
    pressureSpread: Math.round(pressureSpread * 10) / 10,
    sampleCount: samples.length,
    capturedAt: new Date().toISOString()
  }

  const channel = selectedCalibrationChannel.value
  const candidatePoints = sortCalibrationPoints([
    ...channel.points.filter((item) => item.pressureN !== pressure),
    point
  ])
  const validation = validateCalibrationPoints(candidatePoints, {
    requireMinimum: false
  })
  if (!validation.valid) {
    setCalibrationNotice(validation.reason, 'error')
    return
  }

  calibration.value = {
    ...calibration.value,
    updatedAt: new Date().toISOString(),
    channels: calibration.value.channels.map((item, index) =>
      index === selectedCalibrationIndex.value
        ? { ...item, points: candidatePoints }
        : item
    )
  }
  persistCalibration()

  if (pressureConnected.value) {
    calibrationPressure.value = pressure.toFixed(1)
  } else {
    const nextPreset = PRESSURE_PRESETS.find((value) => value > pressure)
    if (nextPreset !== undefined) calibrationPressure.value = String(nextPreset)
  }

  setCalibrationNotice(
    `已记录 ${pressure.toFixed(1)} N：平均 ADC ${Math.round(average)}，ADC 波动 ${Math.round(spread)}${
      pressureConnected.value
        ? `，压力波动 ${pressureSpread.toFixed(1)} N`
        : ''
    }。`,
    'success'
  )
}

function deleteCalibrationPoint(point) {
  const channel = selectedCalibrationChannel.value
  const points = channel.points.filter(
    (item) =>
      item.pressureN !== point.pressureN || item.capturedAt !== point.capturedAt
  )
  calibration.value = {
    ...calibration.value,
    updatedAt: new Date().toISOString(),
    channels: calibration.value.channels.map((item, index) =>
      index === selectedCalibrationIndex.value
        ? { ...item, points }
        : item
    )
  }
  persistCalibration()
  setCalibrationNotice('已删除校准点。', 'info')
}

function clearSelectedCalibration() {
  const channel = selectedCalibrationChannel.value
  if (!channel.points.length) return
  if (!window.confirm(`确定清空 ${channel.id} 的全部校准点吗？`)) return

  calibration.value = {
    ...calibration.value,
    updatedAt: new Date().toISOString(),
    channels: calibration.value.channels.map((item, index) =>
      index === selectedCalibrationIndex.value
        ? { ...item, points: [] }
        : item
    )
  }
  persistCalibration()
  setCalibrationNotice(`已清空 ${channel.id} 的校准数据。`, 'info')
}

function clearAllCalibration() {
  if (!calibratedChannelCount.value) return
  if (!window.confirm('确定清空全部15个通道的校准数据吗？')) return
  calibration.value = createEmptyCalibration()
  persistCalibration()
  setCalibrationNotice('全部压力校准数据已清空。', 'info')
}

function exportCalibration() {
  const blob = new Blob([JSON.stringify(calibration.value, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `mpps-pressure-calibration-${date}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  setCalibrationNotice('校准文件已导出。', 'success')
}

function openCalibrationImport() {
  importFileInput.value?.click()
}

async function importCalibration(event) {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const imported = normalizeCalibrationData(JSON.parse(await file.text()))
    for (const channel of imported.channels) {
      if (!channel.points.length) continue
      const validation = validateCalibrationPoints(channel.points, {
        requireMinimum: false
      })
      if (!validation.valid) {
        throw new Error(`${channel.id}: ${validation.reason}`)
      }
    }
    calibration.value = imported
    persistCalibration()
    setCalibrationNotice('校准文件导入成功。', 'success')
  } catch (error) {
    setCalibrationNotice(`导入失败：${error.message}`, 'error')
  } finally {
    event.target.value = ''
  }
}

function applySample(sampleValues, sourceLabel, options = {}) {
  if (!Array.isArray(sampleValues) || sampleValues.length < CHANNEL_COUNT) {
    return false
  }

  const serialSample = sampleValues.slice(0, CHANNEL_COUNT).map(Number)
  if (!serialSample.every(Number.isFinite)) return false

  const sample = remapLegacyChannelArray(serialSample)
  if (!sample.every(Number.isFinite)) return false

  const rawSample = sample.map((value) =>
    clamp(Math.round(value), 0, ADC_MAX)
  )
  rawValueFrame.value = rawSample
  recordCalibrationSample(rawSample[selectedCalibrationIndex.value])
  recordThresholdLearningSample(rawSample)
  processSequentialThresholdSample(rawSample)
  updateThresholdActivity(rawSample)

  baselineHistory.value.push(rawSample)
  if (baselineHistory.value.length > 5) {
    baselineHistory.value.shift()
  }

  channelValues.value = rawSample.map((value, index) => {
    const learnedBaseline = touchThresholds.value.channels[index]?.baseline
    const effectiveBaseline = Number.isFinite(learnedBaseline)
      ? learnedBaseline
      : baselineValues.value[index]
    return clamp(value - effectiveBaseline, 0, ADC_MAX)
  })
  rawTokens.value = options.rawValues ?? serialSample
  rangeMask.value = options.rangeMask ?? null
  totalFrames.value += 1
  lastFrameAt.value = new Date()
  connectionMessage.value =
    `${sourceLabel} · 已接收 ${CHANNEL_COUNT} 路` +
    (options.rangeMask === null || options.rangeMask === undefined
      ? '（固定 3 V / 兼容 15 值帧）'
      : `（量程位图 ${rangeMaskLabel.value}）`)

  frameTimes.push(performance.now())
  updateFrameRate()

  return true
}

function updateFrameRate() {
  const cutoff = performance.now() - 1000
  frameTimes = frameTimes.filter((timestamp) => timestamp >= cutoff)
  framesPerSecond.value = frameTimes.length
  serialDataFresh.value =
    lastFrameAt.value instanceof Date &&
    Date.now() - lastFrameAt.value.getTime() <= 2000
}

function zeroBaseline() {
  if (!rawValueFrame.value.some(Number.isFinite)) {
    connectionState.value = 'error'
    connectionMessage.value = '尚未收到 ADC 数据，无法清零'
    return
  }

  const history = baselineHistory.value.length
    ? baselineHistory.value
    : [rawValueFrame.value]

  baselineValues.value = rawValueFrame.value.map((_, index) => {
    const total = history.reduce(
      (sum, sample) => sum + (Number.isFinite(sample[index]) ? sample[index] : 0),
      0
    )
    return Math.round(total / history.length)
  })

  channelValues.value = rawValueFrame.value.map((value, index) =>
    clamp(value - baselineValues.value[index], 0, ADC_MAX)
  )
  baselineCapturedAt.value = new Date()
  connectionMessage.value = '静置基线已记录，显示值已扣除当前零点'
}

function consumeText(text) {
  lineBuffer.value += text
  const lines = lineBuffer.value.split(/\r?\n/)
  lineBuffer.value = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !/\d/.test(trimmed)) continue

    const frame = parseSerialFrame(trimmed)
    if (frame) {
      applySample(frame.values, '串口数据', {
        rawValues: frame.rawValues,
        rangeMask: frame.rangeMask
      })
    }
  }
}

function sendServiceMessage(payload) {
  if (serviceSocket?.readyState !== WebSocket.OPEN) return false
  serviceSocket.send(JSON.stringify(payload))
  return true
}

async function requestPorts() {
  try {
    availablePorts.value = await listSerialPorts()
    if (!availablePorts.value.length) {
      connectionMessage.value = '未发现串口，请检查 USB、驱动或端口占用'
    }
  } catch (error) {
    connectionMessage.value = `读取端口列表失败: ${error.message}`
    if (!sendServiceMessage({ type: 'list-ports' })) ensureServiceSocket()
  }
}

function ensureServiceSocket() {
  if (serviceSocket?.readyState === WebSocket.OPEN) {
    serviceReady.value = true
    sendServiceMessage({ type: 'list-ports' })
    return Promise.resolve(true)
  }

  if (serviceConnectPromise) return serviceConnectPromise

  serviceConnectPromise = new Promise((resolve) => {
    connectionState.value = 'connecting'
    connectionMessage.value = '正在连接本地串口服务'

    serviceSocket = createSerialSocket()

    serviceSocket.onopen = () => {
      serviceReady.value = true
      connectionState.value = 'idle'
      connectionMessage.value = '串口服务已连接，请选择 COM 端口'
      sendServiceMessage({ type: 'list-ports' })
      serviceConnectPromise = null
      resolve(true)
    }

    serviceSocket.onmessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      switch (message.type) {
        case 'ports-list':
          availablePorts.value = message.ports ?? []
          if (
            selectedPortPath.value &&
            !availablePorts.value.some(
              (port) => port.path === selectedPortPath.value
            )
          ) {
            selectedPortPath.value = ''
          }
          if (
            pressurePortPath.value &&
            !availablePorts.value.some(
              (port) => port.path === pressurePortPath.value
            )
          ) {
            pressurePortPath.value = ''
          }

          break

        case 'data':
          consumeText(`${String(message.data ?? '')}\n`)
          break

        case 'pressure-data':
          clearTimeout(pressureDataTimer)
          pressureValue.value = Number(message.forceN)
          pressureFrameCount.value += 1
          pressureLastFrameAt.value = new Date()
          recordPressureSample(pressureValue.value)
          if (pressureConnected.value) {
            calibrationPressure.value = pressureValue.value.toFixed(1)
          }
          break

        case 'connect-success':
          activeTransport.value = 'service'
          connectionState.value = 'connected'
          connectionMessage.value = `本地服务已连接 · ${selectedPortPath.value}`
          break

        case 'disconnect-success':
          activeTransport.value = ''
          connectionState.value = 'idle'
          connectionMessage.value = '串口已断开'
          serialDataFresh.value = false
          resetTouchActivity()
          break

        case 'pressure-connect-success':
          pressureConnectionState.value = 'connected'
          pressureConnectionMessage.value = `压力计已连接 · ${pressurePortPath.value}`
          setCalibrationNotice('压力计串口已连接，等待稳定压力数据。', 'success')
          clearTimeout(pressureDataTimer)
          pressureDataTimer = window.setTimeout(() => {
            if (pressureConnectionState.value !== 'connected') return
            if (pressureFrameCount.value > 0) return
            pressureConnectionMessage.value =
              '压力计已打开但未收到数据，请检查端口选择或压力计启动状态'
            setCalibrationNotice(pressureConnectionMessage.value, 'error')
          }, 4500)
          break

        case 'pressure-disconnect-success':
          pressureConnectionState.value = 'idle'
          pressureConnectionMessage.value = '压力计已断开'
          pressureValue.value = null
          pressureFrameCount.value = 0
          clearTimeout(pressureDataTimer)
          setCalibrationNotice('压力计已断开，可继续手动输入压力值。', 'info')
          break

        case 'pressure-error':
          pressureConnectionState.value = 'error'
          pressureConnectionMessage.value =
            message.error ?? '压力计串口连接失败'
          setCalibrationNotice(pressureConnectionMessage.value, 'error')
          break

        case 'error':
          connectionState.value = 'error'
          connectionMessage.value = message.error ?? '本地串口服务返回错误'
          break
      }
    }

    serviceSocket.onerror = () => {
      serviceReady.value = false
      connectionState.value = 'error'
      connectionMessage.value = '本地串口服务未启动，请运行 npm run server'
      serviceConnectPromise = null
      resolve(false)
    }

    serviceSocket.onclose = () => {
      serviceReady.value = false
      serviceConnectPromise = null
      if (activeTransport.value === 'service') {
        activeTransport.value = ''
        connectionState.value = 'error'
        connectionMessage.value = '本地串口服务连接已关闭'
        serialDataFresh.value = false
        resetTouchActivity()
      }
      if (pressureConnectionState.value === 'connected') {
        clearTimeout(pressureDataTimer)
        pressureConnectionState.value = 'error'
        pressureConnectionMessage.value = '压力计串口服务连接已关闭'
      }
      scheduleServiceReconnect()
    }
  })

  return serviceConnectPromise
}

function scheduleServiceReconnect() {
  if (!serviceReconnectEnabled || connectionMode.value !== 'service') return

  window.clearTimeout(serviceReconnectTimer)
  serviceReconnectTimer = window.setTimeout(async () => {
    const ready = await ensureServiceSocket()
    if (ready) {
      connectionState.value = 'idle'
      connectionMessage.value = '串口服务已恢复，请手动连接串口'
      if (pressureConnectionState.value === 'error') {
        pressureConnectionState.value = 'idle'
        pressureConnectionMessage.value = '串口服务已恢复，请重新连接压力计'
      }
    }
  }, 1500)
}

async function connectServicePort() {
  const ready = await ensureServiceSocket()
  if (!ready) return

  if (!selectedPortPath.value) {
    connectionState.value = 'error'
    connectionMessage.value = '请先选择 COM 端口'
    return
  }

  const sent = sendServiceMessage({
    type: 'connect',
    port: selectedPortPath.value,
    baudRate: Number(baudRate.value)
  })

  if (!sent) {
    connectionState.value = 'error'
    connectionMessage.value = '串口服务连接已中断，请稍后重试'
    scheduleServiceReconnect()
    return
  }

  connectionState.value = 'connecting'
  connectionMessage.value = `正在打开 ${selectedPortPath.value}`
}

async function connectPressureGauge() {
  const ready = await ensureServiceSocket()
  if (!ready) return

  if (!pressurePortPath.value) {
    pressureConnectionState.value = 'error'
    pressureConnectionMessage.value = '请选择压力计 COM 端口'
    return
  }
  if (
    connected.value &&
    pressurePortPath.value === selectedPortPath.value
  ) {
    pressureConnectionState.value = 'error'
    pressureConnectionMessage.value = '压力计不能与传感器使用同一个串口'
    return
  }

  const sent = sendServiceMessage({
    type: 'connect-pressure',
    port: pressurePortPath.value,
    baudRate: PRESSURE_GAUGE_BAUD
  })
  if (!sent) {
    pressureConnectionState.value = 'error'
    pressureConnectionMessage.value = '串口服务连接已中断'
    scheduleServiceReconnect()
    return
  }

  pressureConnectionState.value = 'connecting'
  pressureConnectionMessage.value = `正在打开压力计 ${pressurePortPath.value}`
}

function disconnectPressureGauge() {
  if (sendServiceMessage({ type: 'disconnect-pressure' })) {
    pressureConnectionMessage.value = '正在断开压力计'
  }
}

function handleConnectionModeChange() {
  window.clearTimeout(serviceReconnectTimer)
  availablePorts.value = []
  selectedPortPath.value = ''
  activeTransport.value = ''

  if (connectionMode.value === 'service') {
    ensureServiceSocket()
  } else if (!serialSupported) {
    connectionState.value = 'error'
    connectionMessage.value = '当前浏览器不支持 Web Serial，可切换到本地串口服务'
  } else {
    connectionState.value = 'idle'
    connectionMessage.value = '点击连接串口后选择设备'
  }
}

async function connectPort() {
  if (demoRunning.value) stopDemo()

  if (connectionMode.value === 'service') {
    await connectServicePort()
    return
  }

  if (!serialSupported) {
    connectionState.value = 'error'
    connectionMessage.value = '当前浏览器不支持 Web Serial，请使用 Chrome 或 Edge'
    return
  }

  connectionState.value = 'connecting'
  connectionMessage.value = '请选择 XIAO nRF52840 对应的串口'

  try {
    serialPort = await navigator.serial.requestPort()
    await serialPort.open({
      baudRate: Number(baudRate.value),
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none'
    })

    keepReading = true
    connectionState.value = 'connected'
    connectionMessage.value = `USB 串口已连接 · ${baudRate.value} baud`
    readSerialLoop()
  } catch (error) {
    connectionState.value = 'error'
    connectionMessage.value =
      error?.name === 'NotFoundError'
        ? '未选择串口'
        : `串口打开失败：${error?.message ?? '未知错误'}`
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder()
  const port = serialPort

  while (keepReading && port?.readable) {
    serialReader = port.readable.getReader()

    try {
      while (keepReading) {
        const { value, done } = await serialReader.read()
        if (done) break
        consumeText(decoder.decode(value, { stream: true }))
      }
    } catch (error) {
      if (keepReading) {
        connectionState.value = 'error'
        connectionMessage.value = `串口读取中断：${error?.message ?? '未知错误'}`
      }
    } finally {
      serialReader.releaseLock()
      serialReader = null
    }
  }
}

async function disconnectPort() {
  if (activeTransport.value === 'service') {
    sendServiceMessage({ type: 'disconnect' })
    connectionMessage.value = '正在断开串口'
    return
  }

  keepReading = false

  try {
    if (serialReader) await serialReader.cancel()
  } catch {
    // The reader may already be closed after the device is unplugged.
  }

  await new Promise((resolve) => requestAnimationFrame(resolve))

  try {
    if (serialPort) await serialPort.close()
  } catch {
    // Keep the UI responsive when the device disappears first.
  }

  serialPort = null
  serialReader = null
  serialDataFresh.value = false
  resetTouchActivity()
  connectionState.value = 'idle'
  connectionMessage.value = '串口已断开'
  activeTransport.value = ''
}

function startDemo() {
  stopDemo()

  demoRunning.value = true
  connectionState.value = 'demo'
  connectionMessage.value = '正在使用演示数据'

  const baseline = [
    7710, 15774, 11985, 14702, 8931,
    4379, 5708, 2881, 4984, 3494,
    4909, 6897, 7278, 7495, 6897
  ]
  const startedAt = performance.now()

  const update = () => {
    const elapsed = (performance.now() - startedAt) / 1000
    const pressure = 0.38 + 0.52 * (0.5 + 0.5 * Math.sin(elapsed * 0.85))

    const sample = baseline.map((base, index) => {
      const localPulse =
        0.92 + 0.12 * Math.sin(elapsed * 1.8 + index * 0.48)

      return clamp(
        Math.round(base * (0.55 + pressure * 1.15) * localPulse),
        0,
        ADC_MAX
      )
    })

    applySample(sample, '演示模式')
  }

  update()
  demoTimer = window.setInterval(update, 500)
}

function stopDemo() {
  demoRunning.value = false
  if (demoTimer !== null) {
    window.clearInterval(demoTimer)
    demoTimer = null
  }
}

function clearData() {
  stopDemo()
  channelValues.value = Array(CHANNEL_COUNT).fill(null)
  rawValueFrame.value = Array(CHANNEL_COUNT).fill(null)
  baselineValues.value = Array(CHANNEL_COUNT).fill(0)
  baselineHistory.value = []
  baselineCapturedAt.value = null
  rawTokens.value = []
  rangeMask.value = null
  resetTouchActivity()
  lineBuffer.value = ''
  totalFrames.value = 0
  framesPerSecond.value = 0
  frameTimes = []
  lastFrameAt.value = null
  serialDataFresh.value = false

  if (connectionState.value !== 'connected') {
    connectionState.value = 'idle'
    connectionMessage.value = '数据已清空'
  }
}

onMounted(() => {
  loadSavedCalibration()
  loadSavedTouchThresholds()
  fpsTimer = window.setInterval(updateFrameRate, 250)

  if (connectionMode.value === 'service') {
    ensureServiceSocket()
  }

  const params = new URLSearchParams(window.location.search)
  if (params.get('demo') === '1') startDemo()
  if (params.get('calibration') === 'threshold') {
    showCalibration.value = true
    calibrationMode.value = 'threshold'
  }
})

onBeforeUnmount(() => {
  clearTimeout(calibrationCaptureTimer)
  clearInterval(thresholdLearningInterval)
  if (touchThresholdSaveTimer !== null && canCalibrateThresholds.value) {
    clearTimeout(touchThresholdSaveTimer)
    saveTouchThresholdConfig(touchThresholds.value).catch(() => {})
  }
  clearTimeout(pressureDataTimer)
  stopDemo()
  serviceReconnectEnabled = false
  window.clearTimeout(serviceReconnectTimer)
  window.clearInterval(fpsTimer)
  disconnectPort()
  window.setTimeout(() => serviceSocket?.close(), 50)
})
</script>

<template>
  <div class="sensor-page">
    <header class="page-header">
      <div class="title-block">
        <router-link to="/" class="back-link">← 返回首页</router-link>
        <span class="eyebrow">REAL-TIME SENSOR MAP</span>
        <h1>15 通道压力感知可视化</h1>
        <p>读取串口 ADC 数据，将每一路信号映射到叉指电极对应位置。</p>
      </div>

      <div class="connection-panel">
        <div class="connection-status" :class="connectionState">
          <span class="status-dot"></span>
          <div>
            <strong>{{ connected ? '数据在线' : '等待连接' }}</strong>
            <small>{{ connectionMessage }}</small>
          </div>
        </div>

        <label class="mode-field">
          <span>连接方式</span>
          <select
            v-model="connectionMode"
            :disabled="connected"
            @change="handleConnectionModeChange"
          >
            <option value="service">本地串口服务</option>
            <option value="web" :disabled="!serialSupported">
              浏览器 Web Serial
            </option>
          </select>
        </label>

        <template v-if="connectionMode === 'service'">
          <label class="port-field">
            <span>COM 端口</span>
            <select v-model="selectedPortPath" :disabled="connected">
              <option value="">选择端口</option>
              <option
                v-for="port in availablePorts"
                :key="port.path"
                :value="port.path"
              >
                {{ port.friendlyName || port.path }}
              </option>
            </select>
          </label>

          <button class="button button-ghost" @click="requestPorts">
            刷新
          </button>
        </template>

        <label class="baud-field">
          <span>波特率</span>
          <select v-model="baudRate" :disabled="connected">
            <option value="115200">115200</option>
            <option value="230400">230400</option>
            <option value="460800">460800</option>
            <option value="921600">921600</option>
          </select>
        </label>

        <button
          v-if="connectionState !== 'connected'"
          class="button button-primary"
          :disabled="connectionState === 'connecting'"
          @click="connectPort"
        >
          {{ connectionState === 'connecting' ? '连接中...' : '连接串口' }}
        </button>
        <button
          v-else
          class="button button-secondary"
          @click="disconnectPort"
        >
          断开
        </button>

        <button
          class="button button-demo"
          :class="{ active: demoRunning }"
          @click="demoRunning ? stopDemo() : startDemo()"
        >
          {{ demoRunning ? '停止演示' : '演示数据' }}
        </button>
      </div>
    </header>

    <div
      v-if="connectionMode === 'web' && !serialSupported"
      class="service-hint"
    >
      当前浏览器未开放 Web Serial，请切换为“本地串口服务”，或使用
      Chrome / Edge 打开页面。
    </div>
    <div
      v-else-if="connectionMode === 'service' && connectionState === 'error'"
      class="service-hint"
    >
      本地串口服务未连接。请先在项目目录运行
      <code>npm run server</code>，再点击刷新。
    </div>

    <section class="calibration-section" :class="{ open: showCalibration }">
      <header class="calibration-heading">
        <div>
          <span>PALPATION CALIBRATION</span>
          <h2>触诊阈值学习与标定</h2>
          <p>
            先统一静置清零10秒，再按A01～A15逐点按压并记录一次5秒平均值。
            压力测试机标定保留为可选的第二模式。
          </p>
        </div>
        <div class="calibration-heading-actions">
          <strong>
            {{
              calibrationMode === 'threshold'
                ? `${learnedThresholdCount} / 15 个位点已学习`
                : `${calibratedChannelCount} / 15 通道已标定`
            }}
          </strong>
          <span class="threshold-save-state" :class="thresholdSaveState">
            {{ thresholdSaveLabel }}
          </span>
          <button
            type="button"
            class="button button-primary"
            :disabled="
              thresholdLearning.running ||
              thresholdLearning.sessionActive ||
              captureState.running
            "
            @click="showCalibration = !showCalibration"
          >
            {{ showCalibration ? '收起标定' : '打开触诊标定' }}
          </button>
        </div>
      </header>

      <div v-if="showCalibration" class="calibration-body">
        <div class="calibration-mode-tabs">
          <button
            type="button"
            :class="{ active: calibrationMode === 'threshold' }"
            :disabled="
              thresholdLearning.running ||
              thresholdLearning.sessionActive ||
              captureState.running
            "
            @click="calibrationMode = 'threshold'"
          >
            触诊阈值学习
            <small>无需压力测试机</small>
          </button>
          <button
            type="button"
            :class="{ active: calibrationMode === 'pressure' }"
            :disabled="thresholdLearning.running || captureState.running"
            @click="calibrationMode = 'pressure'"
          >
            压力计换算标定
            <small>可选模式</small>
          </button>
        </div>

        <template v-if="calibrationMode === 'threshold'">
          <div class="threshold-status-bar">
            <article>
              <span>当前触诊命中</span>
              <strong>
                {{
                  currentDetectedChannel === null
                    ? '未触发'
                    : channelMeta[currentDetectedChannel].id
                }}
              </strong>
            </article>
            <article>
              <span>已学习位点</span>
              <strong>{{ learnedThresholdCount }} / 15</strong>
            </article>
            <article>
              <span>当前目标位点</span>
              <strong>{{ selectedThresholdChannel.id }}</strong>
            </article>
            <article>
              <span>操作权限</span>
              <strong>
                {{
                  canCalibrateThresholds
                    ? thresholdLearning.running
                      ? '采集中'
                      : '管理员可标定'
                    : '只读'
                }}
              </strong>
            </article>
          </div>

          <div class="calibration-channel-grid">
            <button
              v-for="channel in channelDisplayOrder"
              :key="channel.id"
              type="button"
              :class="{
                active: selectedCalibrationIndex === channel.channelIndex,
                calibrated: Number.isFinite(
                  touchThresholds.channels[channel.channelIndex].threshold
                )
              }"
              :disabled="
                thresholdLearning.running ||
                thresholdLearning.sessionActive ||
                captureState.running
              "
              @click="selectCalibrationChannel(channel.channelIndex)"
            >
              <span>{{ channel.id }}</span>
              <small>
                {{
                  Number.isFinite(
                    touchThresholds.channels[channel.channelIndex].threshold
                  )
                    ? `阈值 ${formatNumber(touchThresholds.channels[channel.channelIndex].threshold)}`
                    : '未校准'
                }}
              </small>
            </button>
          </div>

          <div class="threshold-grid">
            <article class="threshold-training-card">
              <header>
                <div>
                  <span>GUIDED LEARNING</span>
                  <h3>{{ selectedThresholdChannel.id }} 位点阈值学习</h3>
                </div>
                <strong>
                  {{
                    thresholdLearning.running
                      ? '正在自动记录'
                      : thresholdLearning.sequenceActive
                        ? '顺序标定中'
                        : thresholdLearning.sessionBaselineReady
                          ? '基线已就绪'
                          : '等待静置基线'
                  }}
                </strong>
              </header>

              <div
                v-if="thresholdLearning.running || thresholdLearning.sequenceActive"
                class="threshold-phase"
                :class="thresholdLearning.phaseKind"
              >
                <span>{{ thresholdLearning.phaseLabel }}</span>
                <strong>
                  {{
                    thresholdLearning.running
                      ? `${(thresholdLearning.remainingMs / 1000).toFixed(1)} s`
                      : thresholdLearning.phase === 'review'
                        ? '请确认结果'
                        : '按压后点击记录'
                  }}
                </strong>
              </div>
              <div v-else class="threshold-idle-state">
                <span>{{ thresholdLearning.sessionBaselineReady ? 'BASELINE READY' : 'STEP 1' }}</span>
                <strong>
                  {{
                    thresholdLearning.sessionBaselineReady
                      ? '统一静置清零已完成，可开始A01～A15顺序标定。'
                      : '请先点击“静置清零（10秒）”，记录全部15通道的静态基线。'
                  }}
                </strong>
              </div>

              <div class="threshold-progress">
                <i :style="{ width: `${thresholdProgressDisplay}%` }"></i>
              </div>

              <div class="learning-adc-chart">
                <header>
                  <span>实时 ADC 柱状图</span>
                  <small>
                    固定量程 0～10000 ADC，数字为原始 ADC
                  </small>
                </header>
                <div class="learning-chart-bars">
                  <div
                    v-for="(bar, index) in thresholdChartBars"
                    :key="bar.id"
                    class="learning-adc-bar"
                    :class="{
                      target: bar.target,
                      responding: thresholdLearning.sessionActive && bar.delta > 0
                    }"
                  >
                    <span class="adc-value">{{ formatNumber(bar.rawValue) }}</span>
                    <div class="adc-column">
                      <i :style="{ height: `${bar.height}%` }"></i>
                    </div>
                    <small>{{ bar.id }}</small>
                    <em v-if="thresholdLearning.sessionActive">
                      {{ bar.delta > 0 ? `+${bar.delta}` : bar.delta }}
                    </em>
                  </div>
                </div>
              </div>

              <div
                v-if="!thresholdLearning.sequenceActive"
                class="threshold-start-row"
              >
                <button
                  type="button"
                  class="button"
                  :class="
                    thresholdLearning.sessionBaselineReady
                      ? 'button-ghost'
                      : 'button-primary'
                  "
                  :disabled="
                    !connected ||
                    demoRunning ||
                    captureState.running ||
                    !canCalibrateThresholds ||
                    thresholdLearning.running ||
                    !serialDataFresh
                  "
                  @click="startThresholdBaselineCapture"
                >
                  {{
                    thresholdLearning.sessionBaselineReady
                      ? '重新静置清零（10秒）'
                      : '静置清零（10秒）'
                  }}
                </button>
                <button
                  v-if="thresholdLearning.sessionBaselineReady"
                  type="button"
                  class="button button-primary"
                  :disabled="
                    !connected ||
                    demoRunning ||
                    captureState.running ||
                    !canCalibrateThresholds ||
                    thresholdLearning.running ||
                    !serialDataFresh ||
                    !thresholdLearning.sessionBaselineReady
                  "
                  @click="startThresholdLearning"
                >
                  开始 A01～A15 顺序标定
                </button>
              </div>
              <div
                v-else-if="thresholdLearning.phase === 'review'"
                class="threshold-review-card"
              >
                <div class="threshold-review-values">
                  <div>
                    <span>当前测试静置值</span>
                    <strong>
                      {{
                        formatNumber(
                          touchThresholds.baselineValues[
                            thresholdLearning.channelIndex
                          ]
                        )
                      }}
                    </strong>
                  </div>
                  <div>
                    <span>5秒按压平均值</span>
                    <strong>
                      {{ formatNumber(thresholdLearning.result?.averageRaw) }}
                    </strong>
                  </div>
                  <div>
                    <span>计算触发阈值</span>
                    <strong>{{ formatNumber(thresholdLearning.result?.threshold) }}</strong>
                  </div>
                </div>
                <p>是否需要重新标定当前位点？</p>
                <div class="threshold-review-actions">
                  <button
                    type="button"
                    class="button button-primary"
                    @click="confirmCurrentThresholdPoint"
                  >
                    确认，进入下一位点
                  </button>
                  <button
                    type="button"
                    class="button button-ghost"
                    @click="recalibrateCurrentThresholdPoint"
                  >
                    重新标定当前位点
                  </button>
                  <button
                    type="button"
                    class="button button-ghost danger"
                    @click="stopThresholdLearning"
                  >
                    结束标定
                  </button>
                </div>
              </div>
              <div v-else class="threshold-snapshot-actions">
                <button
                  v-if="thresholdLearning.phase === 'waiting-capture'"
                  type="button"
                  class="button button-primary"
                  :disabled="
                    thresholdLearning.running || !serialDataFresh
                  "
                  @click="startSinglePressCapture"
                >
                  {{
                    thresholdLearning.running
                      ? '正在记录5秒...'
                      : `记录当前按压5秒 · ${selectedThresholdChannel.id}`
                  }}
                </button>
                <button
                  type="button"
                  class="button button-ghost danger"
                  :disabled="thresholdLearning.running"
                  @click="stopThresholdLearning"
                >
                  取消顺序标定
                </button>
              </div>

              <div
                v-if="thresholdLearning.sequenceActive"
                class="threshold-sample-counts"
              >
                <span>当前位点：{{ SENSOR_CHANNEL_IDS[thresholdLearning.channelIndex] }}</span>
                <span>
                  当前状态：{{
                    thresholdLearning.phase === 'capturing'
                      ? '记录中'
                      : thresholdLearning.phase === 'review'
                        ? '等待确认'
                        : '等待记录按压'
                  }}
                </span>
                <span>已完成 {{ learnedThresholdCount }} / 15 个位点</span>
              </div>

              <p
                v-if="calibrationNotice.text"
                class="calibration-notice"
                :class="calibrationNotice.tone"
              >
                {{ calibrationNotice.text }}
              </p>
            </article>

            <article class="threshold-result-card">
              <header>
                <div>
                  <span>LEARNED PARAMETERS</span>
                  <h3>{{ selectedThresholdChannel.id }} 阈值参数</h3>
                </div>
                <strong
                  class="quality-badge"
                  :class="selectedThresholdChannel.quality"
                >
                  {{
                    Number.isFinite(selectedThresholdChannel.threshold)
                      ? `最新阈值 ${formatNumber(selectedThresholdChannel.threshold)}`
                      : '未校准'
                  }}
                </strong>
              </header>

              <div
                v-if="Number.isFinite(selectedThresholdChannel.threshold)"
                class="threshold-values"
              >
                <div>
                  <span>静置基线</span>
                  <strong>{{ formatNumber(selectedThresholdChannel.baseline) }}</strong>
                </div>
                <div>
                  <span>最新阈值</span>
                  <strong>{{ selectedThresholdInfo.threshold }}</strong>
                </div>
                <div>
                  <span>释放阈值</span>
                  <strong>{{ selectedThresholdInfo.releaseThreshold }}</strong>
                </div>
                <div>
                  <span>5秒按压平均</span>
                  <strong>{{ formatNumber(selectedThresholdChannel.averageRaw) }}</strong>
                </div>
                <div>
                  <span>按压相对增量</span>
                  <strong>{{ formatNumber(selectedThresholdChannel.averageDelta) }}</strong>
                </div>
                <div>
                  <span>噪声Sigma</span>
                  <strong>{{ selectedThresholdChannel.noiseSigma }}</strong>
                </div>
              </div>
              <div v-else class="empty-points">
                尚未学习该位点。请选择目标位点并完成引导采集。
              </div>

              <div
                v-if="thresholdLearning.diagnostics"
                class="threshold-diagnostics"
              >
                <header>
                  <span>采集诊断</span>
                  <small>单次5秒时间加权采集</small>
                </header>
                <div>
                  <span>5秒平均ADC</span>
                  <b>{{ thresholdLearning.diagnostics.averageRaw ?? '—' }}</b>
                </div>
                <div>
                  <span>静置基线</span>
                  <b>{{ thresholdLearning.diagnostics.baseline ?? '—' }}</b>
                </div>
                <div>
                  <span>平均增量</span>
                  <b>{{ thresholdLearning.diagnostics.averageDelta ?? '—' }}</b>
                </div>
                <div>
                  <span>噪声Sigma</span>
                  <b>{{ thresholdLearning.diagnostics.noiseSigma ?? '—' }}</b>
                </div>
              </div>

              <label class="threshold-scale">
                <span>
                  阈值灵敏度
                  <b>{{ Math.round(touchThresholds.scale * 100) }}%</b>
                </span>
                <input
                  v-model.number="thresholdScale"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  :disabled="!canCalibrateThresholds"
                />
                <small>
                  调低更容易触发，调高可减少误触发，不改变原始学习数据。
                </small>
              </label>

              <div class="threshold-actions">
                <button
                  type="button"
                  class="button button-primary"
                  :disabled="
                    !canCalibrateThresholds ||
                    thresholdLearning.sequenceActive ||
                    thresholdLearning.running
                  "
                  @click="startSingleChannelRecalibration(selectedCalibrationIndex)"
                >
                  重新校准当前通道
                </button>
                <button
                  type="button"
                  class="button button-ghost"
                  :disabled="
                    !canCalibrateThresholds ||
                    !Number.isFinite(selectedThresholdChannel.threshold)
                  "
                  @click="clearSelectedThreshold"
                >
                  清除当前位点
                </button>
                <button
                  type="button"
                  class="button button-primary"
                  :disabled="
                    !canCalibrateThresholds ||
                    !learnedThresholdCount ||
                    thresholdLearning.running ||
                    thresholdLearning.sequenceActive
                  "
                  @click="saveTouchThresholdsManually"
                >
                  保存当前阈值
                </button>
                <button
                  type="button"
                  class="button button-ghost"
                  :disabled="!learnedThresholdCount"
                  @click="exportTouchThresholds"
                >
                  下载阈值备份
                </button>
                <button
                  type="button"
                  class="button button-ghost"
                  :disabled="
                    !canCalibrateThresholds ||
                    thresholdLearning.running ||
                    thresholdLearning.sequenceActive
                  "
                  @click="openThresholdImport"
                >
                  导入阈值文件
                </button>
                <button
                  type="button"
                  class="button button-ghost danger"
                  :disabled="!canCalibrateThresholds || !learnedThresholdCount"
                  @click="clearAllTouchThresholds"
                >
                  清空全部位点
                </button>
              </div>
            </article>
          </div>

          <article class="threshold-table-card">
            <header>
              <span>ALL CHANNEL THRESHOLDS</span>
              <h3>15 通道阈值总览</h3>
            </header>
            <div class="points-table-wrap">
              <table class="points-table threshold-table">
                <thead>
                  <tr>
                    <th>位点</th>
                    <th>基线</th>
                    <th>最新阈值</th>
                    <th>释放</th>
                    <th>按压增量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="channel in channelDisplayOrder"
                    :key="channel.id"
                    :class="{
                      selected:
                        selectedCalibrationIndex === channel.channelIndex
                    }"
                  >
                    <td>{{ channel.id }}</td>
                    <td>
                      {{
                        formatNumber(
                          touchThresholds.channels[channel.channelIndex].baseline
                        )
                      }}
                    </td>
                    <td>
                      {{
                        formatNumber(
                          touchThresholds.channels[channel.channelIndex].threshold
                        )
                      }}
                    </td>
                    <td>
                      {{
                        formatNumber(
                          touchThresholds.channels[channel.channelIndex]
                            .releaseThreshold
                        )
                      }}
                    </td>
                    <td>
                      {{
                        formatNumber(
                          touchThresholds.channels[channel.channelIndex]
                            .pressMedian
                        )
                      }}
                    </td>
                    <td>
                      <button
                        type="button"
                        class="text-button"
                        :disabled="
                          thresholdLearning.running ||
                          thresholdLearning.sessionActive
                        "
                        @click="
                          startSingleChannelRecalibration(channel.channelIndex)
                        "
                      >
                        {{
                          canCalibrateThresholds ? '重新校准' : '查看'
                        }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <input
            ref="thresholdImportFileInput"
            class="hidden-file-input"
            type="file"
            accept="application/json,.json"
            @change="importTouchThresholds"
          />
        </template>

        <template v-else>
        <div class="pressure-gauge-bar" :class="pressureConnectionState">
          <div class="pressure-gauge-title">
            <span>PRESSURE GAUGE</span>
            <strong>压力计串口</strong>
            <small>{{ pressureConnectionMessage }}</small>
          </div>
          <label>
            <span>压力计 COM 端口</span>
            <select
              v-model="pressurePortPath"
              :disabled="pressureConnected || pressureConnectionState === 'connecting'"
            >
              <option value="">选择压力计端口</option>
              <option
                v-for="port in availablePorts"
                :key="port.path"
                :value="port.path"
              >
                {{ port.friendlyName || port.path }}
              </option>
            </select>
          </label>
          <div class="pressure-baud">
            <span>波特率</span>
            <strong>2400</strong>
          </div>
          <div class="pressure-live">
            <span>实时压力</span>
            <strong>
              {{
                Number.isFinite(pressureValue)
                  ? `${pressureValue.toFixed(1)} N`
                  : '— N'
              }}
            </strong>
            <small>{{ pressureFrameCount }} 帧</small>
          </div>
          <div class="pressure-gauge-actions">
            <button
              type="button"
              class="button button-ghost"
              :disabled="pressureConnected"
              @click="requestPorts"
            >
              刷新
            </button>
            <button
              v-if="!pressureConnected"
              type="button"
              class="button button-primary"
              :disabled="
                !pressurePortPath ||
                pressureConnectionState === 'connecting'
              "
              @click="connectPressureGauge"
            >
              {{
                pressureConnectionState === 'connecting'
                  ? '连接中...'
                  : '连接压力计'
              }}
            </button>
            <button
              v-else
              type="button"
              class="button button-secondary"
              @click="disconnectPressureGauge"
            >
              断开压力计
            </button>
          </div>
        </div>

        <div class="calibration-channel-grid">
          <button
            v-for="channel in channelDisplayOrder"
            :key="channel.id"
            type="button"
            :class="{
              active: selectedCalibrationIndex === channel.channelIndex,
              calibrated: hasUsableCalibration(
                calibration.channels[channel.channelIndex].points
              )
            }"
            :disabled="captureState.running"
            @click="selectCalibrationChannel(channel.channelIndex)"
          >
            <span>{{ channel.id }}</span>
            <small>
              {{
                calibration.channels[channel.channelIndex].points.length
              }} 点
            </small>
          </button>
        </div>

        <div class="calibration-grid">
          <article class="capture-card">
            <header>
              <div>
                <span>CAPTURE POINT</span>
                <h3>{{ selectedCalibrationChannel.id }} 点位采集</h3>
              </div>
              <div class="live-adc">
                <span>当前 ADC</span>
                <strong>{{ formatNumber(selectedRawAdc) }}</strong>
                <small>
                  {{
                    selectedLivePressure === null
                      ? '尚未形成有效曲线'
                      : `反算 ${formatPressure(selectedLivePressure)}`
                  }}
                </small>
              </div>
            </header>

            <label class="pressure-input">
              <span>压力测试机示值</span>
              <div>
                <input
                  v-model="calibrationPressure"
                  type="number"
                  min="0"
                  step="0.1"
                  list="pressure-presets"
                  :disabled="captureState.running"
                  :readonly="pressureConnected"
                />
                <b>{{ PRESSURE_UNIT }}</b>
              </div>
              <datalist id="pressure-presets">
                <option
                  v-for="pressure in PRESSURE_PRESETS"
                  :key="pressure"
                  :value="pressure"
                />
              </datalist>
            </label>

            <p v-if="pressureConnected" class="gauge-capture-hint">
              当前使用压力计实时读数，采集时会同步计算压力平均值，不需要手动输入。
            </p>

            <button
              type="button"
              class="capture-button"
              :class="{ capturing: captureState.running }"
              :disabled="captureState.running"
              @click="startCalibrationCapture"
            >
              {{
                captureState.running
                  ? `正在采集 ${captureState.samples.length} 个样本`
                  : '采集并记录当前压力点'
              }}
            </button>

            <p
              v-if="calibrationNotice.text"
              class="calibration-notice"
              :class="calibrationNotice.tone"
            >
              {{ calibrationNotice.text }}
            </p>

            <p class="capture-tip">
              操作顺序：选择点位 → 保持传感器静置并记录 0 N → 用压力测试机施加目标压力 →
              保持稳定约 0.8 秒 → 点击采集。建议至少记录 0 N、中间压力和最大压力三个点。
            </p>
          </article>

          <article class="points-card">
            <header>
              <div>
                <span>CALIBRATION CURVE</span>
                <h3>{{ selectedCalibrationChannel.id }} 校准点</h3>
              </div>
              <div
                class="validation-state"
                :class="{ valid: selectedCalibrationValidation.valid }"
              >
                {{
                  selectedCalibrationValidation.valid
                    ? '曲线可用'
                    : selectedCalibrationValidation.reason
                }}
              </div>
            </header>

            <div v-if="selectedCalibrationPoints.length" class="points-table-wrap">
              <table class="points-table">
                <thead>
                  <tr>
                    <th>压力</th>
                    <th>压力波动</th>
                    <th>平均 ADC</th>
                    <th>ADC 波动</th>
                    <th>样本数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="point in selectedCalibrationPoints"
                    :key="`${point.pressureN}-${point.capturedAt}`"
                  >
                    <td>{{ point.pressureN.toFixed(1) }} N</td>
                    <td>
                      {{
                        Number(point.pressureSpread)
                          ? `${Number(point.pressureSpread).toFixed(1)} N`
                          : '—'
                      }}
                    </td>
                    <td>{{ formatNumber(point.adc) }}</td>
                    <td>{{ formatNumber(point.spread) }}</td>
                    <td>{{ point.sampleCount }}</td>
                    <td>
                      <button
                        type="button"
                        class="text-button danger"
                        @click="deleteCalibrationPoint(point)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="empty-points">
              当前通道尚无校准点。请先采集 0 N，再逐级增加压力。
            </div>

            <footer class="calibration-file-actions">
              <button type="button" class="button button-primary" @click="exportCalibration">
                导出校准文件
              </button>
              <button type="button" class="button button-ghost" @click="openCalibrationImport">
                导入校准文件
              </button>
              <button
                type="button"
                class="button button-ghost"
                :disabled="!selectedCalibrationPoints.length"
                @click="clearSelectedCalibration"
              >
                清空当前通道
              </button>
              <button
                type="button"
                class="button button-ghost danger"
                :disabled="!calibratedChannelCount"
                @click="clearAllCalibration"
              >
                清空全部
              </button>
            </footer>
          </article>
        </div>

        <input
          ref="importFileInput"
          class="hidden-file-input"
          type="file"
          accept="application/json,.json"
          @change="importCalibration"
        />
        </template>
      </div>
    </section>

    <main class="dashboard">
      <section class="visual-card">
        <div class="section-heading">
          <div>
            <span class="section-kicker">SENSOR TOPOLOGY</span>
            <h2>电极压力分布</h2>
          </div>
          <span class="sample-size">ADC 显示 0–10000</span>
        </div>

        <div class="sensor-stage">
          <div class="sensor-frame">
            <img
              src="/sensor-map.png"
              alt="15 通道叉指电极传感器"
              class="sensor-image"
            />

            <button
              v-for="(channel, index) in channelMeta"
              :key="channel.id"
              class="hotspot"
              :class="{
                selected: selectedIndex === index,
                pressed: thresholdActive[index],
                empty: values[index] === null
              }"
              :style="hotspotStyle(channel)"
              :aria-label="`${channel.id} 通道，ADC ${formatNumber(values[index])}`"
              @click="selectedIndex = index"
            >
              <span class="heat-halo"></span>
              <span class="heat-core"></span>
              <span class="hotspot-label">
                {{ channel.id }}
                <strong>{{ formatNumber(values[index]) }}</strong>
                <em v-if="livePressureValues[index] !== null">
                  {{ formatPressure(livePressureValues[index]) }}
                </em>
                <em
                  v-if="Number.isFinite(touchThresholds.channels[index].threshold)"
                  class="hotspot-threshold"
                >
                  阈值 {{ formatNumber(touchThresholds.channels[index].threshold) }}
                </em>
              </span>
            </button>
          </div>
        </div>

        <div class="map-footer">
          <div class="legend">
            <span>低</span>
            <i></i>
            <span>高</span>
          </div>
          <p>颜色按统一量程后的 ADC 线性映射；推荐固件固定使用 3 V 档。</p>
        </div>
      </section>

      <aside class="data-column">
        <section class="summary-grid">
          <article>
            <span>当前最小值</span>
            <strong>{{ formatNumber(stats.min) }}</strong>
          </article>
          <article>
            <span>当前最大值</span>
            <strong>{{ formatNumber(stats.max) }}</strong>
          </article>
          <article>
            <span>数据帧率</span>
            <strong>{{ framesPerSecond.toFixed(1) }} Hz</strong>
          </article>
          <article>
            <span>活跃通道</span>
            <strong>{{ stats.active }} / 15</strong>
          </article>
        </section>

        <section class="channel-list-card">
          <div class="section-heading compact">
            <div>
              <span class="section-kicker">CHANNEL VALUES</span>
              <h2>实时通道</h2>
            </div>
            <div class="channel-actions">
              <span class="chart-unit">
                柱高 = ADC{{ baselineCapturedAt ? ' · 已清零' : '' }}
              </span>
              <button
                class="text-button zero-button"
                :disabled="!rawValueFrame.some(Number.isFinite)"
                @click="zeroBaseline"
              >
                静置清零
              </button>
              <button class="text-button" @click="clearData">清空</button>
            </div>
          </div>

          <div class="channel-chart-scroll">
            <div class="channel-bars">
              <button
                v-for="channel in channelDisplayOrder"
                :key="channel.id"
                class="channel-bar"
                :class="{ pressed: thresholdActive[channel.channelIndex] }"
                :style="barStyle(channel.channelIndex)"
              >
                <span class="bar-track">
                  <i></i>
                </span>
                <span class="bar-name">{{ channel.id }}</span>
                <small>{{ formatNumber(values[channel.channelIndex]) }}</small>
                <em v-if="livePressureValues[channel.channelIndex] !== null">
                  {{ formatPressure(livePressureValues[channel.channelIndex]) }}
                </em>
                <b
                  v-if="
                    Number.isFinite(
                      touchThresholds.channels[channel.channelIndex].threshold
                    )
                  "
                  class="bar-threshold-value"
                >
                  T
                  {{
                    formatNumber(
                      touchThresholds.channels[channel.channelIndex].threshold
                    )
                  }}
                </b>
              </button>
            </div>
          </div>
        </section>

        <section class="raw-card">
          <div class="raw-heading">
            <span>串口原始数据</span>
            <small>{{ rawTokens.length }} 个字段</small>
          </div>
          <code>{{ latestRawLine }}</code>
          <div class="aux-value">
            量程信息：<strong>{{ rangeMaskLabel }}</strong>
          </div>
          <p>
            前 15 个数值映射到 A01–A15；可选的第 16 个字段是量程位图。
            未提供位图时按固定 3 V 或旧 15 值兼容模式处理。
          </p>
        </section>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.sensor-page {
  min-height: calc(100vh - 66px);
  padding: 26px;
  color: #142033;
  background:
    radial-gradient(circle at 12% 4%, rgba(87, 165, 255, 0.13), transparent 30%),
    radial-gradient(circle at 92% 22%, rgba(54, 218, 184, 0.1), transparent 32%),
    #f3f6fa;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 30px;
  border-radius: 24px;
  color: #f8fbff;
  background: linear-gradient(125deg, #0f1f34, #193c53);
  box-shadow: 0 20px 45px rgba(22, 49, 77, 0.18);
}

.title-block {
  flex: 1;
  min-width: 360px;
  max-width: 570px;
}

.back-link {
  display: inline-block;
  margin-bottom: 18px;
  color: #a9c5d8;
  font-size: 12px;
  text-decoration: none;
}

.back-link:hover {
  color: #ffffff;
}

.eyebrow,
.section-kicker {
  display: block;
  margin-bottom: 8px;
  color: #53d9c0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.title-block h1 {
  margin: 0;
  font-size: clamp(24px, 3vw, 36px);
  letter-spacing: -0.04em;
  text-wrap: balance;
}

.title-block p {
  margin: 10px 0 0;
  color: #b9cbe0;
  font-size: 16px;
  line-height: 1.7;
}

.connection-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 9px;
  min-width: 520px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 52px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8092a9;
  box-shadow: 0 0 0 5px rgba(128, 146, 169, 0.14);
  flex: none;
}

.connection-status.connected .status-dot,
.connection-status.demo .status-dot {
  background: #3ee5b5;
  box-shadow: 0 0 0 5px rgba(62, 229, 181, 0.16);
  animation: status-pulse 1.7s infinite;
}

.connection-status.error .status-dot {
  background: #ff7285;
  box-shadow: 0 0 0 5px rgba(255, 114, 133, 0.16);
}

.connection-status strong,
.connection-status small {
  display: block;
}

.connection-status strong {
  font-size: 14px;
}

.connection-status small {
  max-width: 220px;
  margin-top: 3px;
  overflow: hidden;
  color: #a8bdd3;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-field,
.port-field,
.baud-field {
  display: grid;
  gap: 4px;
  color: #a8bdd3;
  font-size: 12px;
}

.mode-field select,
.port-field select,
.baud-field select {
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 11px;
  outline: none;
  color: #f7fbff;
  background: rgba(255, 255, 255, 0.08);
}

.mode-field option,
.port-field option,
.baud-field option {
  color: #142033;
}

.mode-field {
  min-width: 150px;
}

.port-field {
  min-width: 150px;
}

.baud-field {
  min-width: 96px;
}

.button {
  min-height: 36px;
  padding: 0 13px;
  border: 0;
  border-radius: 11px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease;
}

.button:hover {
  transform: translateY(-1px);
}

.button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.button-primary {
  color: #09231f;
  background: #55e1bf;
}

.button-secondary {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}

.button-ghost {
  color: #d9e6f2;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: transparent;
}

.button-demo {
  color: #132431;
  background: #f2c75c;
}

.service-hint {
  margin-top: 14px;
  padding: 12px 16px;
  border: 1px solid #f0d89b;
  border-radius: 14px;
  color: #74581e;
  background: #fff8e5;
  font-size: 12px;
}

.service-hint code {
  font-family: Consolas, monospace;
}

.calibration-section {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid rgba(46, 74, 104, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 12px 32px rgba(37, 64, 93, 0.08);
}

.calibration-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 22px;
}

.calibration-heading > div:first-child > span,
.capture-card header span,
.points-card header span {
  color: #347e70;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.calibration-heading h2 {
  margin: 5px 0 5px;
  font-size: 24px;
}

.calibration-heading p {
  max-width: 760px;
  margin: 0;
  color: #6f8292;
  font-size: 12px;
  line-height: 1.7;
}

.calibration-heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}

.calibration-heading-actions strong {
  color: #3f6577;
  font-size: 12px;
}

.threshold-save-state {
  padding: 5px 8px;
  border-radius: 999px;
  color: #557083;
  background: #edf3f6;
  font-size: 9px;
  font-weight: 700;
}

.threshold-save-state.saved {
  color: #166d59;
  background: #e8f7f2;
}

.threshold-save-state.saving {
  color: #4c6f99;
  background: #eaf2fb;
}

.threshold-save-state.error {
  color: #963f47;
  background: #fff0f2;
}

.calibration-body {
  padding: 0 18px 18px;
  border-top: 1px solid #e3eaee;
}

.calibration-mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-top: 14px;
  padding: 5px;
  border-radius: 11px;
  background: #edf2f5;
}

.calibration-mode-tabs button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 43px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  color: #5b7181;
  background: transparent;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.calibration-mode-tabs button small {
  color: #8b9ba6;
  font-size: 9px;
  font-weight: 600;
}

.calibration-mode-tabs button.active {
  color: #073128;
  background: #63ddc0;
  box-shadow: 0 4px 12px rgba(44, 158, 132, 0.16);
}

.threshold-status-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.threshold-status-bar article {
  display: grid;
  gap: 3px;
  padding: 11px 12px;
  border: 1px solid #e0e8ec;
  border-radius: 10px;
  background: #f7fafb;
}

.threshold-status-bar span {
  color: #7c8e9a;
  font-size: 9px;
}

.threshold-status-bar strong {
  color: #254659;
  font-size: 15px;
}

.threshold-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.1fr);
  gap: 12px;
  margin-top: 12px;
}

.threshold-training-card,
.threshold-result-card,
.threshold-table-card {
  padding: 16px;
  border: 1px solid #dfe8ed;
  border-radius: 14px;
  background: #f8fafb;
}

.threshold-training-card header,
.threshold-result-card header,
.threshold-table-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 15px;
}

.threshold-training-card header span,
.threshold-result-card header span,
.threshold-table-card header span {
  color: #347e70;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.13em;
}

.threshold-training-card h3,
.threshold-result-card h3,
.threshold-table-card h3 {
  margin: 4px 0 0;
  color: #263f51;
  font-size: 18px;
}

.threshold-training-card header > strong {
  color: #3f6577;
  font-size: 10px;
}

.threshold-phase,
.threshold-idle-state {
  display: flex;
  min-height: 92px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 14px;
  padding: 16px;
  border-radius: 12px;
  background: #edf2f5;
}

.threshold-phase.rest {
  color: #3f6577;
  background: #edf3f7;
}

.threshold-phase.press {
  color: #8a3038;
  background: #fff0f1;
}

.threshold-phase span,
.threshold-idle-state strong {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.5;
}

.threshold-phase strong {
  color: #d74752;
  font-size: 28px;
  white-space: nowrap;
}

.threshold-idle-state {
  display: grid;
  align-content: center;
  justify-content: start;
}

.threshold-idle-state span {
  color: #3c8879;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.threshold-progress {
  height: 7px;
  margin: 11px 0;
  overflow: hidden;
  border-radius: 999px;
  background: #e3eaee;
}

.threshold-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3d8bed, #55d9b9);
  transition: width 0.15s linear;
}

.threshold-start-row,
.threshold-snapshot-actions {
  display: grid;
  gap: 7px;
}

.threshold-start-row {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.threshold-snapshot-actions {
  grid-template-columns: 1fr;
}

.threshold-snapshot-actions .button {
  min-height: 39px;
  font-size: 11px;
}

.threshold-snapshot-actions .danger {
  color: #9b3e46;
}

.threshold-sample-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.threshold-sample-counts span {
  padding: 5px 8px;
  border-radius: 999px;
  color: #547080;
  background: #edf3f5;
  font-size: 9px;
  font-weight: 700;
}

.threshold-review-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #b9e1d7;
  border-radius: 11px;
  background: #effaf7;
}

.threshold-review-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.threshold-review-values div {
  display: grid;
  gap: 3px;
  padding: 9px;
  border-radius: 8px;
  background: #fff;
}

.threshold-review-values span {
  color: #718796;
  font-size: 8px;
}

.threshold-review-values strong {
  color: #186f5e;
  font-size: 17px;
}

.threshold-review-card > p {
  margin: 0;
  color: #466575;
  font-size: 11px;
  font-weight: 800;
}

.threshold-review-actions {
  display: grid;
  grid-template-columns: 1.2fr 1fr 0.8fr;
  gap: 6px;
}

.threshold-review-actions .button {
  min-height: 36px;
  padding-inline: 9px;
  font-size: 10px;
}

.learning-adc-chart {
  margin: 12px 0;
  padding: 11px;
  border: 1px solid #dfe8ed;
  border-radius: 11px;
  background: #fff;
}

.learning-adc-chart > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.learning-adc-chart > header span {
  color: #3a6578;
  font-size: 10px;
  font-weight: 900;
}

.learning-adc-chart > header small {
  color: #8898a4;
  font-size: 8px;
}

.learning-chart-bars {
  display: grid;
  grid-template-columns: repeat(15, minmax(0, 1fr));
  gap: 3px;
  min-height: 248px;
}

.learning-adc-bar {
  display: grid;
  grid-template-rows: 15px 205px auto auto;
  gap: 2px;
  min-width: 0;
  text-align: center;
}

.adc-value {
  overflow: hidden;
  color: #6c8190;
  font-size: 9px;
  text-overflow: ellipsis;
}

.adc-column {
  display: flex;
  align-items: flex-end;
  min-width: 0;
  height: 205px;
  overflow: hidden;
  border-radius: 4px 4px 2px 2px;
  background: #edf2f5;
}

.adc-column i {
  display: block;
  width: 100%;
  min-height: 1px;
  border-radius: 4px 4px 2px 2px;
  background: #7397ae;
  transition: height 0.1s linear, background 0.1s linear;
}

.learning-adc-bar small {
  color: #627987;
  font-size: 8px;
  font-weight: 800;
}

.learning-adc-bar em {
  overflow: hidden;
  color: #6f8999;
  font-size: 7px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.learning-adc-bar.target .adc-column {
  outline: 1px solid #79cdbb;
}

.learning-adc-bar.responding .adc-column i {
  background: #e45a64;
}

.learning-adc-bar.target small {
  color: #167f6b;
}

.threshold-result-card header .quality-badge {
  padding: 6px 9px;
  border-radius: 999px;
  color: #718492;
  background: #eaf0f3;
  font-size: 9px;
}

.threshold-result-card header .quality-badge.good {
  color: #136e59;
  background: #e5f7f1;
}

.threshold-result-card header .quality-badge.fair {
  color: #84631f;
  background: #fff5dc;
}

.threshold-result-card header .quality-badge.poor {
  color: #9b3e46;
  background: #fff0f1;
}

.threshold-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  margin-top: 14px;
}

.threshold-values div {
  display: grid;
  gap: 3px;
  padding: 10px;
  border-radius: 9px;
  background: #eef3f5;
}

.threshold-values span {
  color: #7c8e9a;
  font-size: 8px;
}

.threshold-values strong {
  color: #2b4c5e;
  font-size: 15px;
}

.threshold-diagnostics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid #ead8b4;
  border-radius: 9px;
  background: #fffaf0;
}

.threshold-diagnostics header {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.threshold-diagnostics header span {
  color: #876327;
  font-size: 10px;
  font-weight: 900;
}

.threshold-diagnostics header small {
  color: #9b855f;
  font-size: 8px;
}

.threshold-diagnostics > div {
  display: grid;
  gap: 2px;
  padding: 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.72);
}

.threshold-diagnostics > div span {
  color: #8d7b60;
  font-size: 7px;
}

.threshold-diagnostics > div b {
  color: #6d4e1d;
  font-size: 11px;
}

.threshold-scale {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid #e1e8ec;
}

.threshold-scale > span {
  display: flex;
  justify-content: space-between;
  color: #496273;
  font-size: 11px;
  font-weight: 800;
}

.threshold-scale b {
  color: #15856e;
}

.threshold-scale input {
  width: 100%;
  accent-color: #38b99b;
}

.threshold-scale small {
  color: #81929e;
  font-size: 9px;
  line-height: 1.5;
}

.threshold-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 13px;
}

.threshold-actions .button {
  min-height: 33px;
  padding-inline: 10px;
  font-size: 10px;
}

.threshold-table-card {
  margin-top: 12px;
}

.threshold-table tr.selected {
  background: #eef9f6;
}

.pressure-gauge-bar {
  display: grid;
  grid-template-columns:
    minmax(180px, 1.1fr)
    minmax(210px, 1.3fr)
    72px
    minmax(110px, 0.65fr)
    auto;
  align-items: end;
  gap: 11px;
  margin-top: 14px;
  padding: 13px;
  border: 1px solid #dce6eb;
  border-radius: 12px;
  background: #f4f8fa;
}

.pressure-gauge-bar.connected {
  border-color: #a9dfd2;
  background: #f0faf7;
}

.pressure-gauge-bar.error {
  border-color: #edc4c8;
  background: #fff6f6;
}

.pressure-gauge-title {
  display: grid;
  gap: 2px;
}

.pressure-gauge-title > span {
  color: #3c8375;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.13em;
}

.pressure-gauge-title strong {
  color: #284355;
  font-size: 14px;
}

.pressure-gauge-title small {
  color: #7a8d9b;
  font-size: 9px;
}

.pressure-gauge-bar label,
.pressure-baud,
.pressure-live {
  display: grid;
  gap: 4px;
  color: #647b8a;
  font-size: 9px;
  font-weight: 700;
}

.pressure-gauge-bar select {
  width: 100%;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid #cfdae1;
  border-radius: 8px;
  color: #263e50;
  background: #fff;
  font-size: 11px;
}

.pressure-baud strong,
.pressure-live strong {
  min-height: 36px;
  padding: 7px 9px;
  border: 1px solid #d6e0e6;
  border-radius: 8px;
  color: #2b5265;
  background: #fff;
  font-size: 13px;
}

.pressure-live {
  position: relative;
}

.pressure-live small {
  position: absolute;
  right: 5px;
  bottom: 2px;
  color: #8ca0ad;
  font-size: 7px;
}

.pressure-gauge-actions {
  display: flex;
  gap: 6px;
}

.pressure-gauge-actions .button {
  min-height: 36px;
  padding-inline: 10px;
  font-size: 10px;
}

.gauge-capture-hint {
  margin: 8px 0 0;
  color: #247b68;
  font-size: 10px;
  line-height: 1.6;
}

.calibration-channel-grid {
  display: grid;
  grid-template-columns: repeat(15, minmax(0, 1fr));
  gap: 5px;
  margin: 14px 0;
}

.calibration-channel-grid button {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 8px 3px;
  border: 1px solid #dbe5ea;
  border-radius: 8px;
  color: #557084;
  background: #f7fafb;
  cursor: pointer;
}

.calibration-channel-grid button span {
  font-size: 10px;
  font-weight: 900;
}

.calibration-channel-grid button small {
  color: #8d9ca7;
  font-size: 8px;
}

.calibration-channel-grid button.active {
  color: #073029;
  border-color: #5dd8bd;
  background: #e7faf4;
}

.calibration-channel-grid button.calibrated:not(.active) {
  border-color: #a8dfd1;
  background: #f0faf7;
}

.calibration-channel-grid button.calibrated span::after {
  margin-left: 3px;
  color: #1c9b7f;
  content: "•";
}

.calibration-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.76fr) minmax(0, 1.24fr);
  gap: 12px;
}

.capture-card,
.points-card {
  padding: 16px;
  border: 1px solid #dfe8ed;
  border-radius: 14px;
  background: #f8fafb;
}

.capture-card header,
.points-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.capture-card h3,
.points-card h3 {
  margin: 4px 0 0;
  color: #233d50;
  font-size: 18px;
}

.live-adc {
  display: grid;
  justify-items: end;
  gap: 1px;
}

.live-adc span,
.live-adc small {
  color: #768b99;
  font-size: 9px;
}

.live-adc strong {
  color: #147f6c;
  font-size: 25px;
}

.pressure-input {
  display: grid;
  gap: 6px;
  margin-top: 18px;
}

.pressure-input > span {
  color: #496374;
  font-size: 11px;
  font-weight: 800;
}

.pressure-input > div {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  border: 1px solid #cedae1;
  border-radius: 9px;
  background: #fff;
}

.pressure-input input {
  width: 100%;
  min-height: 43px;
  padding: 8px 11px;
  border: 0;
  outline: none;
  color: #1e3445;
  background: transparent;
  font: inherit;
  font-size: 17px;
  font-weight: 800;
}

.pressure-input b {
  padding: 0 13px;
  color: #637b8a;
  font-size: 12px;
}

.capture-button {
  width: 100%;
  min-height: 45px;
  margin-top: 12px;
  border: 0;
  border-radius: 9px;
  color: #062b23;
  background: #5dd9bd;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
}

.capture-button.capturing {
  color: #e8f5fb;
  background: #315b70;
}

.calibration-notice {
  margin: 12px 0 0;
  padding: 9px 11px;
  border-left: 3px solid #4ca9c8;
  border-radius: 6px;
  color: #436574;
  background: #edf6f9;
  font-size: 11px;
  line-height: 1.6;
}

.calibration-notice.success {
  border-left-color: #2cac8c;
  color: #176e5c;
  background: #eefaf6;
}

.calibration-notice.error {
  border-left-color: #c95862;
  color: #94404a;
  background: #fff2f3;
}

.capture-tip {
  margin: 12px 0 0;
  color: #7a8e9c;
  font-size: 10px;
  line-height: 1.7;
}

.validation-state {
  max-width: 220px;
  padding: 6px 8px;
  border-radius: 999px;
  color: #9a5a26;
  background: #fff4df;
  font-size: 9px;
  line-height: 1.4;
  text-align: right;
}

.validation-state.valid {
  color: #17715f;
  background: #e9f8f3;
}

.points-table-wrap {
  margin-top: 14px;
  overflow-x: auto;
}

.points-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.points-table th,
.points-table td {
  padding: 9px 8px;
  border-bottom: 1px solid #e3eaee;
  text-align: left;
}

.points-table th {
  color: #607786;
  background: #eef3f5;
  font-size: 9px;
}

.points-table .text-button {
  padding: 3px;
  color: #a0444c;
}

.empty-points {
  display: grid;
  min-height: 130px;
  margin-top: 14px;
  place-items: center;
  border: 1px dashed #cedce3;
  border-radius: 10px;
  color: #80919d;
  font-size: 11px;
  text-align: center;
}

.calibration-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #e0e8ec;
}

.calibration-file-actions .button {
  min-height: 34px;
  padding: 0 11px;
  font-size: 11px;
}

.calibration-file-actions .danger {
  color: #a04a52;
}

.hidden-file-input {
  display: none;
}

.dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(390px, 450px);
  gap: 20px;
  margin-top: 20px;
}

.visual-card,
.channel-list-card,
.raw-card,
.summary-grid article {
  border: 1px solid rgba(46, 74, 104, 0.1);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 12px 32px rgba(37, 64, 93, 0.08);
}

.visual-card {
  min-width: 0;
  padding: 24px;
  border-radius: 24px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-heading h2 {
  margin: 0;
  font-size: 23px;
  letter-spacing: -0.025em;
}

.section-kicker {
  color: #4f7b98;
}

.sample-size {
  padding: 8px 12px;
  border-radius: 999px;
  color: #4b6174;
  background: #edf2f7;
  font-size: 12px;
  font-weight: 700;
}

.sensor-stage {
  display: grid;
  place-items: center;
  min-height: 560px;
  margin-top: 16px;
  padding: 24px;
  overflow: hidden;
  border-radius: 22px;
  background:
    radial-gradient(circle at 50% 42%, rgba(52, 87, 113, 0.4), transparent 50%),
    #111820;
}

.sensor-frame {
  position: relative;
  width: min(100%, 600px);
  aspect-ratio: 1600 / 1518;
}

.sensor-image {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 22px;
  object-fit: cover;
  opacity: 0.82;
  filter: saturate(0.7) contrast(1.04);
  user-select: none;
}

.hotspot {
  position: absolute;
  z-index: 3;
  width: 70px;
  height: 70px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transform: translate(-50%, -50%);
}

.heat-halo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--halo-size);
  height: var(--halo-size);
  border: 1px solid color-mix(in srgb, var(--accent) 62%, white);
  border-radius: 50%;
  opacity: var(--halo-opacity);
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--accent) 74%, transparent) 0%,
    color-mix(in srgb, var(--accent) 36%, transparent) 44%,
    transparent 72%
  );
  box-shadow: 0 0 var(--halo-blur) var(--accent);
  transform: translate(-50%, -50%);
  transition: width 0.35s ease, height 0.35s ease, opacity 0.35s ease;
}

.heat-core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 13px var(--accent);
  transform: translate(-50%, -50%);
}

.hotspot-label {
  position: absolute;
  top: calc(50% + 15px);
  left: 50%;
  display: grid;
  justify-items: center;
  min-width: 48px;
  padding: 3px 7px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  color: #f8fbff;
  background: rgba(10, 20, 29, 0.76);
  backdrop-filter: blur(7px);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  transform: translateX(-50%);
  pointer-events: none;
}

.hotspot-label strong {
  margin-top: 1px;
  font-size: 10px;
  line-height: 1.1;
}

.hotspot-label em {
  margin-top: 1px;
  color: #65e5c6;
  font-size: 8px;
  font-style: normal;
  line-height: 1.1;
}

.hotspot-label .hotspot-threshold {
  color: #ffcd72;
  font-weight: 800;
}

.hotspot:hover {
  z-index: 7;
}

.hotspot:hover .heat-halo,
.hotspot.selected .heat-halo {
  border-width: 2px;
  filter: brightness(1.15);
  transform: translate(-50%, -50%) scale(1.2);
}

.hotspot.selected .heat-core {
  width: 16px;
  height: 16px;
  box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.12), 0 0 20px var(--accent);
}

.hotspot.pressed {
  z-index: 8;
}

.hotspot.pressed .heat-core {
  width: 19px;
  height: 19px;
  background: #ef5964;
  box-shadow:
    0 0 0 7px rgba(239, 89, 100, 0.2),
    0 0 28px #ef5964;
}

.hotspot.pressed .hotspot-label {
  border-color: rgba(255, 118, 128, 0.75);
  background: rgba(85, 19, 27, 0.9);
}

.hotspot.empty {
  opacity: 0.55;
}

.map-footer {
  display: flex;
  align-items: center;
  gap: 24px;
  justify-content: space-between;
  padding: 16px 4px 0;
}

.legend {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #617486;
  font-size: 11px;
  font-weight: 700;
  flex: none;
}

.legend i {
  width: 180px;
  height: 9px;
  border-radius: 999px;
  background: linear-gradient(90deg, #3b6eff, #2dd4bf, #8ee34f, #ffd166, #f04452);
}

.map-footer p {
  margin: 0;
  color: #75879a;
  font-size: 11px;
  text-align: right;
}

.data-column {
  display: grid;
  align-content: start;
  gap: 14px;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.summary-grid article {
  padding: 15px 16px;
  border-radius: 16px;
}

.summary-grid span,
.summary-grid strong {
  display: block;
}

.summary-grid span {
  color: #728395;
  font-size: 12px;
  font-weight: 700;
}

.summary-grid strong {
  margin-top: 7px;
  font-size: 23px;
  letter-spacing: -0.03em;
}

.channel-list-card,
.raw-card {
  padding: 18px;
  border-radius: 20px;
}

.section-heading.compact h2 {
  font-size: 17px;
}

.channel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chart-unit {
  margin-right: 4px;
  color: #8b9aaa;
  font-size: 9px;
}

.text-button {
  padding: 5px 8px;
  border: 0;
  color: #537087;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
}

.text-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.zero-button {
  color: #176a58;
  font-weight: 700;
}

.channel-chart-scroll {
  margin-top: 14px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.channel-bars {
  display: grid;
  grid-template-columns: repeat(15, minmax(20px, 1fr));
  align-items: end;
  gap: 5px;
  min-width: 410px;
  padding: 8px 2px 2px;
}

.channel-bar {
  display: grid;
  grid-template-rows: 178px auto auto auto auto;
  gap: 4px;
  min-width: 0;
  padding: 5px 3px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: #233548;
  background: transparent;
  text-align: center;
  cursor: pointer;
  transition: border 0.18s ease, background 0.18s ease;
}

.channel-bar:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, #d8e0e8);
  background: color-mix(in srgb, var(--accent) 7%, white);
}

.bar-track {
  position: relative;
  display: flex;
  align-items: flex-end;
  width: 100%;
  min-width: 12px;
  height: 178px;
  overflow: hidden;
  border-radius: 7px 7px 3px 3px;
  background:
    linear-gradient(to top, rgba(91, 116, 139, 0.1) 1px, transparent 1px) 0 0 / 100% 25%,
    #eef3f7;
}

.bar-track i {
  display: block;
  width: 100%;
  height: max(2px, calc(var(--heat) * 100%));
  border-radius: 7px 7px 3px 3px;
  background: linear-gradient(to top, var(--accent), color-mix(in srgb, var(--accent) 55%, white));
  box-shadow: 0 -4px 14px color-mix(in srgb, var(--accent) 35%, transparent);
  transition: height 0.28s ease, background 0.28s ease;
}

.bar-track::after {
  position: absolute;
  right: 0;
  bottom: calc(var(--threshold-heat) * 100%);
  left: 0;
  height: 2px;
  background: rgba(223, 62, 76, 0.9);
  box-shadow: 0 0 7px rgba(223, 62, 76, 0.55);
  content: "";
  opacity: var(--threshold-visible);
  pointer-events: none;
}

.channel-bar.pressed {
  border-color: rgba(220, 65, 79, 0.4);
  background: rgba(255, 238, 240, 0.9);
}

.channel-bar.pressed .bar-name {
  color: #b8333e;
}

.bar-name {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.channel-bar small {
  min-height: 10px;
  overflow: hidden;
  color: #7d8d9d;
  font-size: 9px;
  line-height: 1.2;
  text-overflow: ellipsis;
}

.channel-bar em {
  overflow: hidden;
  color: #16846f;
  font-size: 8px;
  font-style: normal;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-threshold-value {
  overflow: hidden;
  color: #d33944;
  font-size: 8px;
  font-weight: 900;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.raw-card {
  color: #edf6ff;
  background: #172538;
}

.raw-heading {
  display: flex;
  justify-content: space-between;
  color: #9fb3c9;
  font-size: 12px;
  font-weight: 700;
}

.raw-card code {
  display: block;
  max-height: 84px;
  margin-top: 10px;
  overflow: auto;
  color: #65e4c4;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.raw-card p {
  margin: 9px 0 0;
  color: #7f96ad;
  font-size: 10px;
  line-height: 1.5;
}

.aux-value {
  margin-top: 8px;
  color: #d5e4f1;
  font-size: 10px;
}

@keyframes status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 5px rgba(62, 229, 181, 0.14);
  }
  50% {
    box-shadow: 0 0 0 9px rgba(62, 229, 181, 0.04);
  }
}

@media (max-width: 1360px) {
  .page-header {
    flex-direction: column;
  }

  .connection-panel {
    width: 100%;
    min-width: 0;
  }
}

@media (max-width: 1180px) {
  .dashboard {
    grid-template-columns: 1fr;
  }

  .data-column {
    grid-template-columns: 1fr 1fr;
  }

  .summary-grid {
    grid-column: 1 / -1;
  }

  .calibration-grid {
    grid-template-columns: 1fr;
  }

  .calibration-channel-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .pressure-gauge-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pressure-gauge-actions {
    grid-column: 1 / -1;
  }

  .threshold-grid {
    grid-template-columns: 1fr;
  }

  .threshold-status-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .sensor-page {
    padding: 14px;
  }

  .title-block {
    min-width: 0;
  }

  .page-header {
    padding: 20px;
    border-radius: 18px;
  }

  .connection-panel {
    grid-template-columns: 1fr 1fr;
  }

  .connection-status {
    grid-column: 1 / -1;
  }

  .calibration-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .calibration-heading-actions {
    width: 100%;
    align-items: flex-start;
    flex-direction: column;
  }

  .calibration-channel-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .calibration-body {
    padding-inline: 10px;
  }

  .pressure-gauge-bar {
    grid-template-columns: 1fr;
  }

  .pressure-gauge-actions {
    grid-column: auto;
  }

  .calibration-mode-tabs,
  .threshold-status-bar {
    grid-template-columns: 1fr;
  }

  .threshold-values {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .learning-adc-chart {
    overflow-x: auto;
  }

  .learning-chart-bars {
    min-width: 430px;
  }

  .threshold-diagnostics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .threshold-training-card header,
  .threshold-result-card header,
  .threshold-table-card header {
    flex-direction: column;
  }

  .threshold-start-row,
  .threshold-snapshot-actions {
    grid-template-columns: 1fr;
  }

  .threshold-review-values,
  .threshold-review-actions {
    grid-template-columns: 1fr;
  }

  .capture-card header,
  .points-card header {
    flex-direction: column;
  }

  .visual-card {
    padding: 14px;
  }

  .sensor-stage {
    min-height: 0;
    padding: 8px;
  }

  .hotspot {
    width: 48px;
    height: 48px;
  }

  .hotspot-label {
    display: none;
  }

  .map-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .map-footer p {
    text-align: left;
  }

  .data-column {
    grid-template-columns: 1fr;
  }
}
</style>
