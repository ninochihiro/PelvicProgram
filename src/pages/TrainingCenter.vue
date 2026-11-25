<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PelvicModel from '../components/PelvicModel.vue'
import TextPrompt from '../components/TextPrompt.vue'
import { createSerialSocket, listSerialPorts } from '../utils/serialSocket'
import {
  getTouchThresholdConfig,
  saveTrainingResult
} from '../utils/authClient'
import {
  buildBaseline,
  parseSerialFrame,
  strongestStartedChannel,
  subtractBaseline,
  updateChannelLatch
} from '../utils/serialProtocol'
import {
  getPainPointByChannel,
  noTouchRegions,
  painPoints,
  sameAnswer,
  sameNoTouchAnswer
} from '../data/pelvicTraining'

const VALID_MODES = ['learning', 'intensive', 'comprehensive', 'exam']
const LEARNING_HIGHLIGHT_HOLD_MS = 5000
const modeModules = [
  {
    key: 'learning',
    number: '01',
    title: '基础学习',
    subtitle: '结构与位置',
    description: '自由查看 15 个痛点、对应肌群和两个勿触区域。',
    guide: ['选择左侧结构列表', '观察 3D 模型高亮', '阅读文字提示与解剖说明']
  },
  {
    key: 'intensive',
    number: '02',
    title: '准确性训练',
    subtitle: '单目标校准',
    description: '系统随机给出痛点、肌群或勿触区域目标。',
    guide: ['根据提示寻找目标', '完成按压或人工定位', '每题最多尝试三次']
  },
  {
    key: 'comprehensive',
    number: '03',
    title: '全面性训练',
    subtitle: '完整检查流程',
    description: '逐项完成全部痛点与勿触区域，并输入正确名称。',
    guide: ['选择待检查目标', '完成按压并填写名称', '查看遗漏项与完成进度']
  },
  {
    key: 'exam',
    number: '04',
    title: '模拟考场',
    subtitle: '综合能力测评',
    description: '随机完成书面判断与按压定位，结束后统一复盘。',
    guide: ['记录书面答案', '完成按压或人工确认', '查看得分与误触记录']
  }
]
const route = useRoute()
const router = useRouter()
const initialMode = VALID_MODES.includes(String(route.query.mode))
  ? String(route.query.mode)
  : 'learning'

const mode = ref(initialMode)
const modelRef = ref(null)
const THRESHOLD_MODE_STORAGE_KEY = 'mpps-training-threshold-mode'
const FIXED_THRESHOLD_STORAGE_KEY = 'mpps-training-fixed-threshold'
const savedThresholdMode =
  window.localStorage.getItem(THRESHOLD_MODE_STORAGE_KEY) === 'calibrated'
    ? 'calibrated'
    : 'fixed'
const savedFixedThreshold = Number(
  window.localStorage.getItem(FIXED_THRESHOLD_STORAGE_KEY)
)
const thresholdMode = ref(savedThresholdMode)
const threshold = ref(
  Number.isFinite(savedFixedThreshold) && savedFixedThreshold > 0
    ? savedFixedThreshold
    : 800
)
const perChannelThresholds = ref(Array(15).fill(null))
const perChannelReleaseThresholds = ref(Array(15).fill(null))
const thresholdConfigLoading = ref(false)
const thresholdConfigError = ref('')
const pressureValues = ref(Array(15).fill(0))
const rawValues = ref(Array(15).fill(0))
const baselineValues = ref(Array(15).fill(null))
const calibrationState = ref('idle')
const calibrated = computed(() =>
  baselineValues.value.every((value) => Number.isFinite(value))
)
const receivedFrameCount = ref(0)
const rangeMask = ref(null)
const protocolMessage = ref('等待固定 3 V 串口帧')
const pressureActive = ref(Array(15).fill(false))
const channelCooldownUntil = Array(15).fill(0)
let calibrationFrames = []
let calibrationTimer = null

const perChannelThresholdReady = computed(() =>
  perChannelThresholds.value.every(
    (value) => Number.isFinite(value) && value > 0
  )
)
const effectiveThresholds = computed(() =>
  thresholdMode.value === 'fixed'
    ? Array(15).fill(threshold.value)
    : perChannelThresholds.value
)
const effectiveReleaseThresholds = computed(() =>
  thresholdMode.value === 'fixed'
    ? null
    : perChannelReleaseThresholds.value
)
const activeChannels = computed(() =>
  pressureValues.value
    .map((value, index) => ({ index, value }))
    .filter(
      (item) =>
        Number.isFinite(effectiveThresholds.value[item.index]) &&
        item.value >= effectiveThresholds.value[item.index]
    )
    .sort((a, b) => b.value - a.value)
)
const currentModeMeta = computed(
  () => modeModules.find((item) => item.key === mode.value) ?? modeModules[0]
)

watch(threshold, (value) => {
  window.localStorage.setItem(FIXED_THRESHOLD_STORAGE_KEY, String(value))
})

async function loadPerChannelThresholds() {
  thresholdConfigLoading.value = true
  thresholdConfigError.value = ''
  try {
    const payload = await getTouchThresholdConfig()
    const channels = Array.isArray(payload?.config?.channels)
      ? payload.config.channels
      : []
    const scale = Number.isFinite(Number(payload?.config?.scale))
      ? Number(payload.config.scale)
      : 1
    perChannelThresholds.value = Array.from({ length: 15 }, (_, index) => {
      const id = `A${String(index + 1).padStart(2, '0')}`
      const channel = channels.find((item) => item?.id === id)
      const value = Number(channel?.threshold)
      return Number.isFinite(value) && value > 0
        ? Math.max(1, Math.round(value * scale))
        : null
    })
    perChannelReleaseThresholds.value = Array.from(
      { length: 15 },
      (_, index) => {
        const id = `A${String(index + 1).padStart(2, '0')}`
        const channel = channels.find((item) => item?.id === id)
        const value = Number(channel?.releaseThreshold)
        return Number.isFinite(value) && value >= 0
          ? Math.max(1, Math.round(value * scale))
          : null
      }
    )
  } catch (error) {
    thresholdConfigError.value = error.message
    perChannelThresholds.value = Array(15).fill(null)
    perChannelReleaseThresholds.value = Array(15).fill(null)
  } finally {
    thresholdConfigLoading.value = false
  }
}

function openThresholdCalibration() {
  router.push({
    path: '/sensor',
    query: { calibration: 'threshold' }
  })
}

async function selectThresholdMode(nextMode) {
  thresholdMode.value = nextMode === 'calibrated' ? 'calibrated' : 'fixed'
  window.localStorage.setItem(
    THRESHOLD_MODE_STORAGE_KEY,
    thresholdMode.value
  )
  if (thresholdMode.value === 'calibrated') {
    await loadPerChannelThresholds()
    openThresholdCalibration()
  }
}

function ensureThresholdReady() {
  if (thresholdMode.value === 'fixed') return true
  if (perChannelThresholdReady.value) return true
  announce(
    '当前使用校准阈值模式，请先前往传感工具完成 15 个通道的触觉标定。',
    'warning',
    '需要分通道标定'
  )
  return false
}

async function persistCompletedResult(module, payload) {
  resultSaveState.status = 'saving'
  resultSaveState.message = '正在保存成绩...'
  try {
    await saveTrainingResult({
      module,
      completedAt: new Date().toISOString(),
      ...payload
    })
    resultSaveState.status = 'saved'
    resultSaveState.message = '本次成绩已保存到数据库'
  } catch (error) {
    resultSaveState.status = 'error'
    resultSaveState.message = `成绩保存失败：${error.message}`
  }
}

const selectedPoint = ref(null)
const selectedNoTouch = ref(null)
const announcement = ref('')
const popup = reactive({
  visible: false,
  title: '训练提示',
  message: '',
  tone: 'info'
})
const popupQueue = []
let popupTimer = null
let learningHighlightTimer = null
let learningHighlightFromPressure = false
let learningHighlightLastSignalAt = 0

const availablePorts = ref([])
const selectedPortPath = ref('')
const baudRate = ref('460800')
const socketConnected = ref(false)
const serialConnected = ref(false)
const connectionMessage = ref('正在连接本地串口服务')

const practice = reactive({
  running: false,
  order: [],
  index: 0,
  attempts: 0,
  feedback: '',
  reveal: false,
  locked: false,
  correct: 0,
  wrong: 0,
  completed: 0,
  startedAt: null,
  records: []
})

const foundPainChannels = ref([])
const foundNoTouchIds = ref([])
const comprehensiveSession = reactive({
  startedAt: null,
  records: [],
  wrongCount: 0,
  saved: false
})
const resultSaveState = reactive({
  status: 'idle',
  message: ''
})

const exam = reactive({
  running: false,
  completed: false,
  order: [],
  index: 0,
  attempts: 0,
  feedback: '',
  reveal: false,
  locked: false,
  typedAnswer: '',
  writtenChecked: false,
  writtenCorrect: false,
  wrongPoints: [],
  records: [],
  startedAt: null,
  saved: false
})

const bonyPointIds = new Set([
  'coccyx',
  'left-ischial-spine',
  'right-ischial-spine'
])

const practiceItems = [
  ...painPoints.map((point) => ({
    kind: 'pain',
    id: point.id,
    source: point,
    channel: point.channel,
    title: point.title,
    prompt: point.prompt,
    nodes: point.nodes,
    origin: point.origin,
    functions: point.functions
  })),
  ...painPoints
    .filter((point) => !bonyPointIds.has(point.id))
    .map((point) => ({
      kind: 'pain',
      id: `muscle-${point.id}`,
      source: point,
      channel: point.channel,
      title: `${point.region}${point.muscle}`,
      prompt: `请按压${point.region}${point.muscle}`,
      nodes: point.nodes,
      origin: point.origin,
      functions: point.functions
    })),
  ...noTouchRegions.map((region) => ({
    kind: 'noTouch',
    id: region.id,
    source: region,
    channel: null,
    title: region.title,
    prompt: `请定位${region.title}，阅读说明并确认勿触要求`,
    nodes: [],
    origin: region.description,
    functions: [region.warning]
  }))
]

const examItems = [
  ...painPoints.map((point) => ({
    kind: 'pain',
    source: point,
    id: point.id,
    code: point.code,
    channel: point.channel,
    title: point.title,
    prompt: point.prompt,
    nodes: point.nodes,
    origin: point.origin
  })),
  ...noTouchRegions.map((region) => ({
    kind: 'noTouch',
    source: region,
    id: region.id,
    code: '勿触',
    channel: null,
    title: region.title,
    prompt: `请确认${region.title}的位置与勿触要求，并填写区域名称`,
    nodes: [],
    origin: region.description
  }))
]

const comprehensiveAnswer = ref('')
const comprehensiveTarget = ref(null)

let socket = null
let reconnectTimer = null

const currentDetail = computed(() =>
  selectedNoTouch.value || selectedPoint.value
)

const learningAnnotation = computed(() => {
  if (
    mode.value !== 'learning' ||
    selectedNoTouch.value ||
    !selectedPoint.value
  ) {
    return null
  }
  return {
    code: selectedPoint.value.code,
    kicker: '痛点识别',
    title: selectedPoint.value.title,
    origin: selectedPoint.value.origin,
    functions: selectedPoint.value.functions,
    nodes: selectedPoint.value.nodes
  }
})

const practiceTarget = computed(() => practice.order[practice.index] ?? null)

const comprehensiveProgress = computed(() => {
  const found = foundPainChannels.value.length + foundNoTouchIds.value.length
  return {
    found,
    total: painPoints.length + noTouchRegions.length,
    percent: Math.round((found / (painPoints.length + noTouchRegions.length)) * 100)
  }
})

const examTarget = computed(() => exam.order[exam.index] ?? null)

const examScore = computed(() => {
  if (!exam.records.length) return 0
  const earned = exam.records.reduce(
    (sum, record) =>
      sum +
      Number(record.writtenCorrect) +
      (record.kind === 'noTouch' ? 0 : Number(record.pressureCorrect)),
    0
  )
  const available = exam.records.reduce(
    (sum, record) => sum + (record.kind === 'noTouch' ? 1 : 2),
    0
  )
  return Math.round((earned / available) * 100)
})

watch(
  () => route.query.mode,
  (value) => {
    if (VALID_MODES.includes(String(value))) mode.value = String(value)
  }
)

watch(mode, (nextMode) => {
  clearLearningHighlightTimer()
  learningHighlightFromPressure = false
  learningHighlightLastSignalAt = 0
  modelRef.value?.resetHighlight()
  selectedPoint.value = null
  selectedNoTouch.value = null
  pressureActive.value = Array(15).fill(false)
  channelCooldownUntil.fill(0)

  if (nextMode !== 'intensive') practice.running = false
  if (nextMode !== 'exam') exam.running = false
  if (nextMode !== 'comprehensive') comprehensiveTarget.value = null
  if (nextMode === 'exam') comprehensiveAnswer.value = ''
})

function showNextPopup() {
  if (popup.visible || !popupQueue.length) return
  const next = popupQueue.shift()
  popup.title = next.title
  popup.message = next.message
  popup.tone = next.tone
  popup.visible = true
}

function announce(text, tone = 'info', title = '训练提示') {
  announcement.value = text
  popupQueue.push({ message: text, tone, title })
  clearTimeout(popupTimer)
  popupTimer = window.setTimeout(showNextPopup, popup.visible ? 0 : 10)
}

function closePopup() {
  popup.visible = false
  clearTimeout(popupTimer)
  popupTimer = window.setTimeout(showNextPopup, 180)
}

function changeMode(nextMode) {
  if (!VALID_MODES.includes(nextMode)) return
  mode.value = nextMode
  router.replace({
    path: '/training',
    query: { ...route.query, mode: nextMode }
  })
}

function shuffle(items) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function clearLearningHighlightTimer() {
  if (learningHighlightTimer !== null) {
    window.clearTimeout(learningHighlightTimer)
    learningHighlightTimer = null
  }
}

function clearLearningHighlight() {
  clearLearningHighlightTimer()
  learningHighlightFromPressure = false
  learningHighlightLastSignalAt = 0
  if (mode.value !== 'learning') return
  selectedPoint.value = null
  modelRef.value?.resetHighlight()
}

function scheduleLearningHighlightRelease(delay = LEARNING_HIGHLIGHT_HOLD_MS) {
  clearLearningHighlightTimer()
  learningHighlightTimer = window.setTimeout(() => {
    learningHighlightTimer = null
    const remaining =
      LEARNING_HIGHLIGHT_HOLD_MS -
      (performance.now() - learningHighlightLastSignalAt)
    if (remaining > 0) {
      scheduleLearningHighlightRelease(remaining)
    } else {
      clearLearningHighlight()
    }
  }, delay)
}

function selectPoint(point, { fromPressure = false } = {}) {
  clearLearningHighlightTimer()
  learningHighlightFromPressure = fromPressure
  selectedPoint.value = point
  selectedNoTouch.value = null
  modelRef.value?.highlightNodes(point.nodes)
  if (fromPressure) {
    learningHighlightLastSignalAt = performance.now()
    scheduleLearningHighlightRelease()
  } else {
    learningHighlightLastSignalAt = 0
  }
}

function updateLearningHighlightHold(values) {
  if (
    mode.value !== 'learning' ||
    !learningHighlightFromPressure ||
    !selectedPoint.value
  ) {
    return
  }
  const channelValue = Number(values[selectedPoint.value.channel])
  if (Number.isFinite(channelValue) && channelValue > 1) {
    learningHighlightLastSignalAt = performance.now()
    if (learningHighlightTimer === null) {
      scheduleLearningHighlightRelease()
    }
  }
}

function selectNoTouch(region) {
  selectedNoTouch.value = region
  modelRef.value?.resetHighlight()
  announce(
    `${region.title}：${region.warning}。${region.description}`,
    'warning',
    '勿触区域'
  )
}

function selectComprehensivePoint(point) {
  if (!comprehensiveSession.startedAt) {
    comprehensiveSession.startedAt = new Date().toISOString()
    resultSaveState.status = 'idle'
    resultSaveState.message = ''
  }
  selectedPoint.value = point
  selectedNoTouch.value = null
  comprehensiveTarget.value = { kind: 'pain', source: point }
  comprehensiveAnswer.value = ''
  modelRef.value?.highlightNodes(point.nodes)
  announce(
    `已选择${point.title}。请根据当前按压位置填写解剖名称。`,
    'info',
    '全面性练习'
  )
}

function selectComprehensiveNoTouch(region) {
  if (!comprehensiveSession.startedAt) {
    comprehensiveSession.startedAt = new Date().toISOString()
    resultSaveState.status = 'idle'
    resultSaveState.message = ''
  }
  selectedNoTouch.value = region
  comprehensiveTarget.value = { kind: 'noTouch', source: region }
  comprehensiveAnswer.value = ''
  modelRef.value?.resetHighlight()
  announce(
    `已选择${region.title}。请阅读说明并填写该区域名称。`,
    'warning',
    '勿触区练习'
  )
}

function checkComprehensiveAnswer() {
  const target = comprehensiveTarget.value
  if (!target) {
    announce('请先选择一个练习目标。', 'warning')
    return
  }

  const source = target.source
  const correct =
    target.kind === 'pain'
      ? sameAnswer(comprehensiveAnswer.value, source)
      : sameNoTouchAnswer(comprehensiveAnswer.value, source)

  if (!correct) {
    comprehensiveSession.records.push({
      targetId: source.id,
      code: target.kind === 'pain' ? source.code : 'NO-TOUCH',
      title: source.title,
      kind: target.kind,
      correct: false,
      answer: comprehensiveAnswer.value
    })
    comprehensiveSession.wrongCount += 1
    announce(
      `名称不正确，请重新判断${target.kind === 'pain' ? '痛点所属结构' : '勿触区域名称'}。`,
      'error',
      '答案未匹配'
    )
    return
  }

  if (target.kind === 'pain') {
    if (!foundPainChannels.value.includes(source.channel)) {
      foundPainChannels.value = [...foundPainChannels.value, source.channel]
    }
    modelRef.value?.highlightNodes(source.nodes, 0x26b884)
    announce(
      `正确，${source.title}。${source.origin}`,
      'success',
      '识别正确'
    )
  } else if (!foundNoTouchIds.value.includes(source.id)) {
    foundNoTouchIds.value = [...foundNoTouchIds.value, source.id]
    announce(
      `正确，${source.title}。${source.warning}。${source.description}`,
      'success',
      '勿触区确认'
    )
  }

  comprehensiveSession.records.push({
    targetId: source.id,
    code: target.kind === 'pain' ? source.code : 'NO-TOUCH',
    title: source.title,
    kind: target.kind,
    correct: true,
    answer: comprehensiveAnswer.value
  })
  comprehensiveAnswer.value = ''
  comprehensiveTarget.value = null
  if (
    foundPainChannels.value.length + foundNoTouchIds.value.length ===
    painPoints.length + noTouchRegions.length
  ) {
    announce(
      '全面性基础练习已完成，15 个痛点和 2 个勿触区域均已确认。',
      'success',
      '练习完成'
    )
    if (!comprehensiveSession.saved) {
      comprehensiveSession.saved = true
      const total = painPoints.length + noTouchRegions.length
      persistCompletedResult('comprehensive', {
        score: Math.round((total / (total + comprehensiveSession.wrongCount)) * 100),
        correctCount: total,
        wrongCount: comprehensiveSession.wrongCount,
        totalCount: total,
        startedAt: comprehensiveSession.startedAt,
        details: comprehensiveSession.records
      })
    }
  }
}

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(payload))
  return true
}

async function requestPorts() {
  try {
    availablePorts.value = await listSerialPorts()
    if (!availablePorts.value.length) {
      connectionMessage.value = '未发现串口，请检查 USB、驱动或是否被其他程序占用'
    }
  } catch (error) {
    connectionMessage.value = `读取端口列表失败: ${error.message}`
    send({ type: 'list-ports' })
  }
}

function connectSocket() {
  if (socket?.readyState === WebSocket.OPEN) {
    requestPorts()
    return
  }

  socket = createSerialSocket()
  socket.onopen = () => {
    socketConnected.value = true
    connectionMessage.value = '串口服务已连接，请选择 COM 端口'
    requestPorts()
  }
  socket.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }

    if (message.type === 'ports-list') {
      availablePorts.value = message.ports ?? []
    } else if (message.type === 'data') {
      handleSerialLine(String(message.data ?? ''))
    } else if (message.type === 'connect-success') {
      serialConnected.value = true
      connectionMessage.value = `已连接 ${selectedPortPath.value}`
      receivedFrameCount.value = 0
      window.setTimeout(() => startCalibration(true), 250)
    } else if (message.type === 'disconnect-success') {
      serialConnected.value = false
      connectionMessage.value = '串口已断开'
      resetCalibration()
    } else if (message.type === 'error') {
      connectionMessage.value = message.error ?? '串口错误'
    }
  }
  socket.onerror = () => {
    socketConnected.value = false
    connectionMessage.value = '串口服务未连接'
  }
  socket.onclose = () => {
    socketConnected.value = false
    serialConnected.value = false
    connectionMessage.value = '串口服务连接关闭'
    resetCalibration()
    clearTimeout(reconnectTimer)
    reconnectTimer = window.setTimeout(connectSocket, 1500)
  }
}

function connectSerial() {
  if (!selectedPortPath.value) {
    connectionMessage.value = '请先选择 COM 端口'
    return
  }

  if (!send({
    type: 'connect',
    port: selectedPortPath.value,
    baudRate: Number(baudRate.value)
  })) {
    connectSocket()
    return
  }

  connectionMessage.value = `正在连接 ${selectedPortPath.value}`
}

function disconnectSerial() {
  send({ type: 'disconnect' })
}

function resetCalibration() {
  clearTimeout(calibrationTimer)
  calibrationFrames = []
  baselineValues.value = Array(15).fill(null)
  pressureValues.value = Array(15).fill(0)
  pressureActive.value = Array(15).fill(false)
  channelCooldownUntil.fill(0)
  calibrationState.value = 'idle'
}

function finishCalibration() {
  clearTimeout(calibrationTimer)
  baselineValues.value = buildBaseline(calibrationFrames)
  calibrationFrames = []
  calibrationState.value = 'ready'
  pressureValues.value = Array(15).fill(0)
  pressureActive.value = Array(15).fill(false)
  channelCooldownUntil.fill(0)
  connectionMessage.value = '基线已记录，可以开始训练'
  announce(
    '静置基线已完成。训练过程中请保持传感器初始状态，不要同时按压多个区域。',
    'success',
    '校准完成'
  )
}

function startCalibration(automatic = false) {
  if (!serialConnected.value) {
    announce('请先连接串口，再将传感器静置后采集基线。', 'warning', '尚未连接')
    return
  }

  clearTimeout(calibrationTimer)
  calibrationFrames = []
  baselineValues.value = Array(15).fill(null)
  pressureValues.value = Array(15).fill(0)
  pressureActive.value = Array(15).fill(false)
  channelCooldownUntil.fill(0)
  calibrationState.value = 'collecting'
  announce(
    `请保持 15 路传感器静置，正在采集约 1 秒基线${automatic ? '。' : '，完成后会弹出提示。'}`,
    'info',
    '基线校准'
  )

  calibrationTimer = window.setTimeout(() => {
    if (calibrationState.value !== 'collecting') return
    calibrationState.value = 'idle'
    calibrationFrames = []
    connectionMessage.value = '基线采集超时，请检查串口数据'
    announce(
      '没有收到足够的串口数据，基线采集失败。请检查固件和串口连接后重试。',
      'error',
      '校准失败'
    )
  }, 4500)
}

function handleSerialLine(text) {
  const frame = parseSerialFrame(text)
  if (!frame) return

  receivedFrameCount.value += 1
  rawValues.value = frame.rawValues
  rangeMask.value = frame.hasRangeMask ? frame.rangeMask : null
  protocolMessage.value = frame.hasRangeMask
    ? `量程位图 0x${frame.rangeMask.toString(16).toUpperCase()}`
    : '15 值兼容帧；固件建议固定 3 V'

  if (calibrationState.value === 'collecting') {
    calibrationFrames.push(frame.values)
    if (calibrationFrames.length >= 20) finishCalibration()
    return
  }

  const values = calibrated.value
    ? subtractBaseline(frame.values, baselineValues.value)
    : frame.values
  pressureValues.value = values
  updateLearningHighlightHold(values)

  const { active, started } = updateChannelLatch(
    values,
    pressureActive.value,
    effectiveThresholds.value,
    effectiveReleaseThresholds.value
  )
  pressureActive.value = active

  if (!calibrated.value) return

  const now = performance.now()
  const eligible = started.map(
    (isStarted, index) =>
      isStarted && now >= (channelCooldownUntil[index] ?? 0)
  )
  const strongest = strongestStartedChannel(values, eligible)
  if (!strongest) return

  channelCooldownUntil[strongest.index] = now + 650
  const point = getPainPointByChannel(strongest.index)
  if (!point) return

  triggerPoint(point, strongest.value)
}

function triggerPoint(point, value) {
  if (mode.value === 'learning') {
    selectPoint(point, { fromPressure: true })
    return
  }

  if (mode.value === 'comprehensive') {
    if (!comprehensiveSession.startedAt) {
      comprehensiveSession.startedAt = new Date().toISOString()
      resultSaveState.status = 'idle'
      resultSaveState.message = ''
    }
    selectedPoint.value = point
    selectedNoTouch.value = null
    comprehensiveTarget.value = { kind: 'pain', source: point }
    comprehensiveAnswer.value = ''
    modelRef.value?.highlightNodes(point.nodes, 0x40cfa7)
    announce(
      `已检测到按压信号，请填写当前触及的痛点或肌群名称。信号值 ${Math.round(value)}。`,
      'info',
      '全面性练习'
    )
    return
  }

  if (mode.value === 'intensive' && practice.running) {
    handlePracticePressure(point)
    return
  }

  if (mode.value === 'exam' && exam.running) {
    handleExamPressure(point)
  }
}

function startPractice() {
  if (!ensureThresholdReady()) return
  if (!calibrated.value) {
    announce(
      '准确性练习需要先完成静置基线采集。请保持传感器无按压后重新校准。',
      'warning',
      '需要校准'
    )
    startCalibration()
    return
  }

  practice.running = true
  practice.order = shuffle(practiceItems)
  practice.index = 0
  practice.correct = 0
  practice.wrong = 0
  practice.completed = 0
  practice.startedAt = new Date().toISOString()
  practice.records = []
  practice.locked = false
  resultSaveState.status = 'idle'
  resultSaveState.message = ''
  loadPracticeQuestion()
}

function loadPracticeQuestion() {
  practice.attempts = 0
  practice.feedback = ''
  practice.reveal = false
  practice.locked = false
  modelRef.value?.resetHighlight()

  if (practice.index >= practice.order.length) {
    practice.running = false
    announce(
      `准确性练习完成。完成 ${practice.completed} 个目标，首次或本次练习正确 ${practice.correct} 个。`,
      'success',
      '练习完成'
    )
    persistCompletedResult('intensive', {
      score: Math.round(
        (practice.correct / Math.max(1, practice.order.length)) * 100
      ),
      correctCount: practice.correct,
      wrongCount: practice.wrong,
      totalCount: practice.order.length,
      startedAt: practice.startedAt,
      details: practice.records
    })
    return
  }

  announce(practiceTarget.value.prompt)
}

function handlePracticePressure(point) {
  const target = practiceTarget.value
  if (!target || target.kind !== 'pain' || practice.locked) return

  if (point.channel === target.channel) {
    practice.locked = true
    practice.correct++
    practice.completed++
    practice.records.push({
      targetId: target.id,
      code: target.code,
      title: target.title,
      kind: target.kind,
      correct: true,
      attempts: practice.attempts + 1,
      detectedChannel: point.channel
    })
    practice.feedback = `正确：${target.title}`
    practice.reveal = false
    modelRef.value?.highlightNodes(target.nodes, 0x26b884)
    announce(
      `按压正确，您目前按压的是${target.title}。`,
      'success',
      '按压正确'
    )
    window.setTimeout(nextPracticeQuestion, 900)
    return
  }

  practice.attempts++
  practice.wrong++
  practice.records.push({
    targetId: target.id,
    code: target.code,
    title: target.title,
    kind: target.kind,
    correct: false,
    attempts: practice.attempts,
    detectedChannel: point.channel
  })
  practice.feedback =
    `错误：检测到${point.title}，当前目标为${target.title}`

  if (practice.attempts >= 3) {
    practice.locked = true
    practice.reveal = true
    practice.completed++
    modelRef.value?.highlightNodes(target.nodes, 0xff5a5f)
    announce(
      `连续三次错误。正确答案是${target.title}。${target.origin}`,
      'error',
      '正确答案'
    )
    window.setTimeout(nextPracticeQuestion, 1800)
  } else {
    announce(
      `按压错误，请重新按压${target.title}。剩余 ${2 - practice.attempts} 次机会。`,
      'error',
      '按压错误'
    )
  }
}

function confirmPracticeNoTouch() {
  const target = practiceTarget.value
  if (!target || target.kind !== 'noTouch' || practice.locked) return

  practice.locked = true
  practice.correct++
  practice.completed++
  practice.records.push({
    targetId: target.id,
    code: 'NO-TOUCH',
    title: target.source.title,
    kind: target.kind,
    correct: true,
    attempts: 1
  })
  practice.feedback = `${target.source.warning}：${target.title}`
  announce(
    `${target.title}，${target.source.warning}。${target.source.description}`,
    'warning',
    '勿触区确认'
  )
  window.setTimeout(nextPracticeQuestion, 1200)
}

function nextPracticeQuestion() {
  practice.index++
  loadPracticeQuestion()
}

function resetComprehensive() {
  foundPainChannels.value = []
  foundNoTouchIds.value = []
  comprehensiveSession.startedAt = null
  comprehensiveSession.records = []
  comprehensiveSession.wrongCount = 0
  comprehensiveSession.saved = false
  resultSaveState.status = 'idle'
  resultSaveState.message = ''
  selectedNoTouch.value = null
  comprehensiveTarget.value = null
  comprehensiveAnswer.value = ''
  modelRef.value?.resetHighlight()
  announce(
    '全面性练习已重置，请依次完成 15 个痛点并确认两个勿触区域。',
    'info',
    '练习重置'
  )
}

function startExam() {
  if (!ensureThresholdReady()) return
  if (!calibrated.value) {
    announce(
      '模拟考场需要先完成静置基线采集。请保持传感器无按压后重新校准。',
      'warning',
      '需要校准'
    )
    startCalibration()
    return
  }

  exam.running = true
  exam.completed = false
  exam.order = shuffle(examItems)
  exam.index = 0
  exam.attempts = 0
  exam.feedback = ''
  exam.reveal = false
  exam.locked = false
  exam.typedAnswer = ''
  exam.writtenChecked = false
  exam.writtenCorrect = false
  exam.wrongPoints = []
  exam.records = []
  exam.startedAt = new Date().toISOString()
  exam.saved = false
  resultSaveState.status = 'idle'
  resultSaveState.message = ''
  modelRef.value?.resetHighlight()
  announce(examTarget.value.prompt, 'info', '模拟考场')
}

function checkWrittenAnswer() {
  if (!examTarget.value) return
  exam.writtenCorrect =
    examTarget.value.kind === 'noTouch'
      ? sameNoTouchAnswer(exam.typedAnswer, examTarget.value.source)
      : sameAnswer(exam.typedAnswer, examTarget.value.source)
  exam.writtenChecked = true
  exam.feedback = '书面答案已记录，提交按压后统一评分'
  announce(
    '书面答案已记录。考试过程中暂不显示答案正误，请完成按压。',
    'info',
    '答案已记录'
  )
}

function handleExamPressure(point) {
  const target = examTarget.value
  if (!target || target.kind !== 'pain' || exam.locked) return

  const pressureCorrect = point.channel === target.channel
  if (!pressureCorrect) {
    exam.attempts++
    if (!exam.wrongPoints.includes(point.title)) {
      exam.wrongPoints = [...exam.wrongPoints, point.title]
    }
  }

  const writtenCorrect = sameAnswer(exam.typedAnswer, target.source)
  exam.writtenCorrect = writtenCorrect
  exam.writtenChecked = true

  if (pressureCorrect) {
    exam.locked = true
    completeExamQuestion({
      target,
      writtenCorrect,
      pressureCorrect: true,
      attempts: exam.attempts + 1,
      kind: 'pain',
      wrongPoints: [...exam.wrongPoints],
      revealed: false
    })
    return
  }

  exam.feedback = `检测到${point.title}，与目标不一致`
  if (exam.attempts >= 3) {
    exam.locked = true
    exam.reveal = true
    modelRef.value?.highlightNodes(target.nodes, 0xff5a5f)
    completeExamQuestion({
      target,
      writtenCorrect,
      pressureCorrect: false,
      attempts: exam.attempts,
      kind: 'pain',
      wrongPoints: [...exam.wrongPoints],
      revealed: true
    })
  } else {
    announce(
      `按压位置与目标不一致，还有 ${3 - exam.attempts} 次机会。`,
      'error',
      '按压错误'
    )
  }
}

function submitNoTouchExam() {
  const target = examTarget.value
  if (!target || target.kind !== 'noTouch' || exam.locked) return

  const writtenCorrect = sameNoTouchAnswer(exam.typedAnswer, target.source)
  exam.writtenCorrect = writtenCorrect
  exam.writtenChecked = true
  exam.locked = true
  completeExamQuestion({
    target,
    writtenCorrect,
    pressureCorrect: null,
    attempts: 0,
    kind: 'noTouch',
    wrongPoints: [],
    revealed: false
  })
}

function completeExamQuestion(record) {
  exam.records.push(record)
  exam.feedback =
    record.kind === 'noTouch'
      ? '勿触区名称与定位已提交'
      : record.pressureCorrect
        ? '本题按压正确'
        : `三次机会已用完，正确答案：${record.target.title}`

  window.setTimeout(() => {
    exam.index++
    exam.attempts = 0
    exam.typedAnswer = ''
    exam.writtenChecked = false
    exam.writtenCorrect = false
    exam.wrongPoints = []
    exam.reveal = false
    exam.locked = false
    exam.feedback = ''
    modelRef.value?.resetHighlight()

    if (exam.index >= exam.order.length) {
      exam.running = false
      exam.completed = true
      if (!exam.saved) {
        exam.saved = true
        const correctCount = exam.records.filter((record) =>
          record.kind === 'noTouch'
            ? record.writtenCorrect
            : record.writtenCorrect && record.pressureCorrect
        ).length
        persistCompletedResult('exam', {
          score: examScore.value,
          correctCount,
          wrongCount: Math.max(0, exam.records.length - correctCount),
          totalCount: exam.records.length,
          startedAt: exam.startedAt,
          details: exam.records.map((record) => ({
            targetId: record.target.id,
            code: record.target.code,
            title: record.target.title,
            kind: record.kind,
            writtenCorrect: record.writtenCorrect,
            pressureCorrect: record.pressureCorrect,
            attempts: record.attempts,
            wrongPoints: record.wrongPoints,
            revealed: record.revealed
          }))
        })
      }
      announce(
        `模拟考场完成，最终得分 ${examScore.value} 分。请查看逐题答题结果。`,
        'success',
        '考试完成'
      )
    } else {
      announce(examTarget.value.prompt, 'info', '模拟考场')
    }
  }, 1200)
}

function resetExam() {
  exam.running = false
  exam.completed = false
  exam.records = []
  exam.index = 0
  exam.attempts = 0
  exam.feedback = ''
  exam.locked = false
  exam.typedAnswer = ''
  exam.writtenChecked = false
  exam.writtenCorrect = false
  exam.reveal = false
  exam.wrongPoints = []
  exam.startedAt = null
  exam.saved = false
  resultSaveState.status = 'idle'
  resultSaveState.message = ''
  modelRef.value?.resetHighlight()
}

onMounted(() => {
  connectSocket()
  if (thresholdMode.value === 'calibrated') {
    loadPerChannelThresholds()
  }
})

onBeforeUnmount(() => {
  clearTimeout(reconnectTimer)
  clearTimeout(calibrationTimer)
  clearTimeout(popupTimer)
  clearLearningHighlightTimer()
  socket?.close()
})
</script>

<template>
  <div class="training-page">
    <TextPrompt
      :visible="popup.visible"
      :title="popup.title"
      :message="popup.message"
      :tone="popup.tone"
      @close="closePopup"
    />

    <header class="training-header">
      <div class="header-copy">
        <span class="eyebrow">PELVIC FLOOR TRAINING WORKSPACE</span>
        <h1>盆底肌培训工作台</h1>
        <p>设备准备、结构学习、训练与考核统一在同一工作流程中。</p>
      </div>

      <div class="header-metrics">
        <article>
          <span>当前模块</span>
          <strong>{{ currentModeMeta.title }}</strong>
          <small>{{ currentModeMeta.subtitle }}</small>
        </article>
        <article>
          <span>设备状态</span>
          <strong :class="{ online: serialConnected }">
            {{ serialConnected ? '在线' : '离线' }}
          </strong>
          <small>{{ connectionMessage }}</small>
        </article>
        <article>
          <span>检测基线</span>
          <strong :class="{ online: calibrated }">
            {{
              calibrationState === 'collecting'
                ? '采集中'
                : calibrated
                  ? '已就绪'
                  : '待校准'
            }}
          </strong>
          <small>{{ receivedFrameCount }} 帧已接收</small>
        </article>
      </div>
    </header>

    <section class="device-console" aria-label="设备与检测设置">
      <header class="console-heading">
        <div>
          <span>DEVICE CONTROL</span>
          <h2>设备与检测设置</h2>
        </div>
        <p>开始练习前请完成串口连接与静置基线校准。</p>
      </header>

      <div class="device-grid">
        <article class="device-card">
          <div class="device-card-heading">
            <span class="device-icon">COM</span>
            <div>
              <strong>串口连接</strong>
              <small>{{ serialConnected ? '压力数据正在传输' : '等待选择 COM 端口' }}</small>
            </div>
            <i :class="{ online: serialConnected }"></i>
          </div>
          <div class="device-fields">
            <label>
              <span>COM 端口</span>
              <select v-model="selectedPortPath" :disabled="serialConnected">
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
            <label>
              <span>波特率</span>
              <select v-model="baudRate" :disabled="serialConnected">
                <option value="115200">115200</option>
                <option value="460800">460800</option>
                <option value="921600">921600</option>
              </select>
            </label>
          </div>
          <div class="port-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="serialConnected"
              @click="requestPorts"
            >
              刷新端口
            </button>
            <button
              v-if="!serialConnected"
              class="primary-button"
              :disabled="!socketConnected || !availablePorts.length"
              @click="connectSerial"
            >
              连接串口
            </button>
            <button v-else class="secondary-button" @click="disconnectSerial">
              断开串口
            </button>
          </div>
        </article>

        <article class="device-card" :class="`calibration-${calibrationState}`">
          <div class="device-card-heading">
            <span class="device-icon">REF</span>
            <div>
              <strong>静置基线</strong>
              <small>扣除每个通道的初始压力</small>
            </div>
            <i :class="{ online: calibrated }"></i>
          </div>
          <div class="calibration-summary">
            <span>状态</span>
            <strong>
              {{
                calibrationState === 'collecting'
                  ? '正在采集'
                  : calibrated
                    ? '校准完成'
                    : '尚未校准'
              }}
            </strong>
            <small>{{ protocolMessage }}</small>
          </div>
          <button
            class="secondary-button wide"
            type="button"
            :disabled="!serialConnected || calibrationState === 'collecting'"
            @click="startCalibration(false)"
          >
            {{ calibrated ? '重新采集基线' : '采集静置基线' }}
          </button>
        </article>

        <article class="device-card">
          <div class="device-card-heading">
            <span class="device-icon">THR</span>
            <div>
              <strong>触发灵敏度</strong>
              <small>
                {{
                  thresholdMode === 'fixed'
                    ? `固定阈值模式 · 当前有 ${activeChannels.length} 路超过阈值`
                    : perChannelThresholdReady
                      ? '分通道阈值已就绪'
                      : '分通道阈值尚未完成'
                }}
              </small>
            </div>
            <i :class="{ online: activeChannels.length > 0 }"></i>
          </div>

          <div class="threshold-mode-selector" role="group" aria-label="阈值模式">
            <button
              type="button"
              :class="{ active: thresholdMode === 'fixed' }"
              @click="selectThresholdMode('fixed')"
            >
              固定阈值
            </button>
            <button
              type="button"
              :class="{ active: thresholdMode === 'calibrated' }"
              @click="selectThresholdMode('calibrated')"
            >
              校准阈值
            </button>
          </div>

          <template v-if="thresholdMode === 'fixed'">
            <label class="threshold-setting">
              <span>
                触发阈值
                <b>{{ threshold }}</b>
              </span>
              <input
                v-model.number="threshold"
                type="range"
                min="100"
                max="5000"
                step="100"
              />
            </label>
            <p class="device-note">
              数值越高，需要更明显的按压才会触发；15 个通道共用这个阈值。
            </p>
          </template>

          <div v-else class="calibrated-threshold-panel">
            <div>
              <span>分通道阈值</span>
              <strong v-if="thresholdConfigLoading">正在读取…</strong>
              <strong v-else-if="perChannelThresholdReady">15 / 15 已校准</strong>
              <strong v-else>需要重新标定</strong>
              <small v-if="thresholdConfigError" class="threshold-config-error">
                {{ thresholdConfigError }}
              </small>
              <small v-else>
                每个通道使用传感工具中保存的独立阈值。
              </small>
            </div>
            <button
              type="button"
              class="secondary-button"
              @click="openThresholdCalibration"
            >
              打开触觉标定
            </button>
          </div>
        </article>
      </div>
    </section>

    <nav class="workflow-nav" aria-label="培训工作流程">
      <button
        v-for="moduleItem in modeModules"
        :key="moduleItem.key"
        type="button"
        class="workflow-step"
        :class="{ active: mode === moduleItem.key }"
        :aria-pressed="mode === moduleItem.key"
        @click="changeMode(moduleItem.key)"
      >
        <span class="workflow-number">{{ moduleItem.number }}</span>
        <div>
          <strong>{{ moduleItem.title }}</strong>
          <small>{{ moduleItem.subtitle }}</small>
        </div>
        <em>{{ mode === moduleItem.key ? '当前模块' : '进入' }}</em>
      </button>
    </nav>

    <section class="mode-guide">
      <div>
        <span>当前模块 {{ currentModeMeta.number }}</span>
        <h2>{{ currentModeMeta.title }}</h2>
        <p>{{ currentModeMeta.description }}</p>
      </div>
      <ol>
        <li v-for="(item, index) in currentModeMeta.guide" :key="item">
          <b>{{ index + 1 }}</b>
          <span>{{ item }}</span>
        </li>
      </ol>
    </section>

    <main class="training-workspace">
      <section class="model-card">
        <div class="model-toolbar">
          <div>
            <span>3D ANATOMY FEEDBACK</span>
            <strong>模型反馈区</strong>
          </div>
          <small>{{ activeChannels.length }} 路触发</small>
        </div>
        <PelvicModel
          ref="modelRef"
          :annotation="learningAnnotation"
          :focus-nodes="learningAnnotation?.nodes ?? []"
        />
        <div class="sensor-strip">
          <span
            v-for="(point, index) in painPoints"
            :key="point.id"
            :class="{ active: pressureActive[index] }"
          >
            {{ point.code }}
          </span>
        </div>
      </section>

      <aside class="content-panel">
        <template v-if="mode === 'learning'">
          <div class="panel-heading">
            <div>
              <span>ANATOMY LEARNING</span>
              <h2>15 个痛点与勿触区域</h2>
            </div>
            <b>{{ painPoints.length }} 痛点 + {{ noTouchRegions.length }} 勿触</b>
          </div>

          <div class="point-grid">
            <button
              v-for="point in painPoints"
              :key="point.id"
              :class="{ active: selectedPoint?.id === point.id }"
              @click="selectPoint(point)"
            >
              <span>{{ point.code }}</span>
              {{ point.title }}
            </button>
          </div>

          <div class="no-touch-row">
            <button
              v-for="region in noTouchRegions"
              :key="region.id"
              :class="{ active: selectedNoTouch?.id === region.id }"
              @click="selectNoTouch(region)"
            >
              <strong>{{ region.title }}</strong>
              <small>{{ region.warning }}</small>
            </button>
          </div>

          <article
            v-if="selectedNoTouch"
            class="detail-card danger"
          >
            <span>NO-TOUCH REGION</span>
            <h2>{{ currentDetail.title }}</h2>
            <p>{{ selectedNoTouch.description }}</p>
          </article>
        </template>

        <template v-else-if="mode === 'intensive'">
          <div class="panel-heading">
            <div>
              <span>ACCURACY PRACTICE</span>
              <h2>按压准确性练习</h2>
            </div>
            <b>每题 3 次机会</b>
          </div>

          <article v-if="!practice.running" class="session-intro">
            <span>TRAINING OVERVIEW</span>
            <h3>逐项建立稳定的按压定位能力</h3>
            <p>
              系统会随机给出痛点、肌群或勿触区域目标。痛点与肌群使用压力通道判断，
              勿触区域采用人工定位确认。
            </p>
            <div class="session-facts">
              <div>
                <b>{{ practiceItems.length }}</b>
                <small>训练目标</small>
              </div>
              <div>
                <b>3</b>
                <small>按压机会</small>
              </div>
              <div>
                <b>{{ calibrated ? '就绪' : '待校准' }}</b>
                <small>设备状态</small>
              </div>
            </div>
            <button class="primary-button wide" @click="startPractice">
              开始准确性练习
            </button>
          </article>

          <template v-else>
            <div class="training-progress">
              <span>进度 {{ practice.index + 1 }} / {{ practice.order.length }}</span>
              <span>已正确 {{ practice.correct }}</span>
              <span>错误 {{ practice.wrong }}</span>
            </div>
            <article class="prompt-card">
              <span>当前目标</span>
              <h2>{{ practiceTarget?.prompt }}</h2>
              <p v-if="practiceTarget?.kind === 'pain'">
                已尝试 {{ practice.attempts }} / 3 次
              </p>
              <p v-else>
                当前区域没有独立压力通道，请阅读说明后手动确认是否已定位。
              </p>
              <button
                v-if="practiceTarget?.kind === 'noTouch'"
                class="secondary-button wide"
                @click="confirmPracticeNoTouch"
              >
                已阅读勿触说明并完成定位
              </button>
              <strong v-if="practice.feedback">{{ practice.feedback }}</strong>
              <div v-if="practice.reveal" class="answer-reveal">
                正确答案：{{ practiceTarget?.title }}
                <p>{{ practiceTarget?.origin }}</p>
              </div>
            </article>
          </template>
        </template>

        <template v-else-if="mode === 'comprehensive'">
          <div class="panel-heading">
            <div>
              <span>COMPREHENSIVE PRACTICE</span>
              <h2>按压全面性练习</h2>
            </div>
            <b>{{ comprehensiveProgress.percent }}%</b>
          </div>

          <div class="progress-bar">
            <i :style="{ width: `${comprehensiveProgress.percent}%` }"></i>
          </div>
          <p class="progress-copy">
            已完成 {{ comprehensiveProgress.found }} /
            {{ comprehensiveProgress.total }} 个目标。
          </p>

          <div class="checklist">
            <button
              v-for="point in painPoints"
              :key="point.id"
              :class="{ done: foundPainChannels.includes(point.channel) }"
              @click="selectComprehensivePoint(point)"
            >
              <span>{{ point.code }}</span>
              {{ point.title }}
              <b>{{ foundPainChannels.includes(point.channel) ? '已完成' : '待练习' }}</b>
            </button>
            <button
              v-for="region in noTouchRegions"
              :key="region.id"
              class="no-touch-item"
              :class="{ done: foundNoTouchIds.includes(region.id) }"
              @click="selectComprehensiveNoTouch(region)"
            >
              <span>勿触</span>
              {{ region.title }}
              <b>{{ foundNoTouchIds.includes(region.id) ? '已确认' : '待确认' }}</b>
            </button>
          </div>

          <article v-if="comprehensiveTarget" class="answer-review">
            <strong>
              当前目标：{{ comprehensiveTarget.source.title }}
            </strong>
            <label class="answer-field">
              <span>解剖名称</span>
              <input
                v-model="comprehensiveAnswer"
                placeholder="填写触点或勿触区域名称"
                @keyup.enter="checkComprehensiveAnswer"
              />
            </label>
            <button class="primary-button wide" @click="checkComprehensiveAnswer">
              确认名称
            </button>
          </article>

          <button class="secondary-button wide" @click="resetComprehensive">
            重新练习
          </button>
        </template>

        <template v-else>
          <div class="panel-heading">
            <div>
              <span>SIMULATED EXAM</span>
              <h2>模拟考场</h2>
            </div>
            <b v-if="exam.completed">得分 {{ examScore }}</b>
          </div>

          <article
            v-if="!exam.running && !exam.completed"
            class="session-intro exam-intro"
          >
            <span>EXAM OVERVIEW</span>
            <h3>完成书面判断与按压定位综合测评</h3>
            <p>
              考场覆盖 15 个痛点和 2 个勿触区域。考试过程中不提前显示答案正误，
              结束后统一给出得分和误触记录。
            </p>
            <div class="session-facts">
              <div>
                <b>{{ examItems.length }}</b>
                <small>考核题目</small>
              </div>
              <div>
                <b>3</b>
                <small>按压机会</small>
              </div>
              <div>
                <b>100</b>
                <small>满分</small>
              </div>
            </div>
            <button class="primary-button wide" @click="startExam">
              开始模拟考核
            </button>
          </article>

          <article v-else-if="exam.running" class="exam-card">
            <span>问题 {{ exam.index + 1 }} / {{ exam.order.length }}</span>
            <h2>{{ examTarget?.prompt }}</h2>
            <p v-if="examTarget?.kind === 'pain'">
              当前用文字弹窗代替语音提示。本题有 3 次按压机会。
            </p>
            <p v-else>
              当前区域没有独立压力通道。请填写名称，并在完成后提交人工定位确认。
            </p>

            <label class="answer-field">
              <span>书面答案</span>
              <input
                v-model="exam.typedAnswer"
                :placeholder="
                  examTarget?.kind === 'noTouch'
                    ? '填写勿触区域名称'
                    : '填写痛点或肌群名称'
                "
                @keyup.enter="checkWrittenAnswer"
              />
            </label>
            <button class="text-button" @click="checkWrittenAnswer">记录书面答案</button>
            <button
              v-if="examTarget?.kind === 'noTouch'"
              class="primary-button wide"
              @click="submitNoTouchExam"
            >
              提交本题
            </button>

            <div class="training-progress">
              <span>
                {{
                  examTarget?.kind === 'noTouch'
                    ? '人工定位确认题'
                    : `按压尝试 ${exam.attempts} / 3`
                }}
              </span>
              <span>书面答案 {{ exam.writtenChecked ? '已记录' : '未记录' }}</span>
            </div>
            <strong v-if="exam.feedback">{{ exam.feedback }}</strong>
            <div v-if="exam.reveal" class="answer-reveal">
              正确答案：{{ examTarget?.title }}
              <p>{{ examTarget?.origin }}</p>
            </div>
          </article>

          <template v-else>
            <article class="result-card">
              <span>FINAL SCORE</span>
              <strong>{{ examScore }}</strong>
              <p>痛点题书面答案与按压操作各占 50%；勿触区题按书面答案计分。</p>
            </article>
            <div class="exam-results">
              <div v-for="record in exam.records" :key="record.target.id">
                <span>{{ record.target.code }} {{ record.target.title }}</span>
                <b>{{ record.writtenCorrect ? '书面正确' : '书面错误' }}</b>
                <b>
                  {{
                    record.kind === 'noTouch'
                      ? '人工确认题'
                      : record.pressureCorrect
                        ? '按压正确'
                        : '按压错误'
                  }}
                </b>
                <small v-if="record.wrongPoints?.length">
                  误触记录：{{ record.wrongPoints.join('、') }}
                </small>
              </div>
            </div>
            <button class="primary-button wide" @click="resetExam">重新考核</button>
          </template>
        </template>

        <p
          v-if="resultSaveState.message"
          class="result-save-state"
          :class="resultSaveState.status"
          aria-live="polite"
        >
          {{ resultSaveState.message }}
        </p>

        <section class="announcement-card">
          <span>文字提示记录</span>
          <p aria-live="polite">
            {{ announcement || '进行操作后，这里会保存最近一次文字提示。' }}
          </p>
        </section>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.training-page {
  min-height: calc(100vh - 66px);
  padding: 20px clamp(16px, 2.5vw, 34px) 36px;
  overflow-x: hidden;
  color: #172538;
  background:
    radial-gradient(circle at 8% 6%, rgba(68, 157, 225, 0.12), transparent 28%),
    #eef3f7;
}

.training-header {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 25px 28px;
  color: #f5fbff;
  border-radius: 22px;
  background:
    radial-gradient(circle at 82% 18%, rgba(74, 224, 192, 0.18), transparent 30%),
    linear-gradient(125deg, #10233b, #194c62);
  box-shadow: 0 18px 40px rgba(28, 60, 87, 0.15);
}

.back-link {
  display: block;
  margin-bottom: 14px;
  color: #b9d1e3;
  font-size: 12px;
  text-decoration: none;
}

.eyebrow,
.panel-heading span,
.prompt-card > span,
.detail-card > span,
.announcement-card > span,
.result-card > span,
.exam-card > span {
  display: block;
  color: #51dab8;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.training-header h1 {
  margin: 7px 0 6px;
  font-size: clamp(28px, 3vw, 38px);
  letter-spacing: -0.035em;
}

.training-header p {
  margin: 0;
  color: #b5c9db;
  font-size: 15px;
}

.header-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(118px, 1fr));
  gap: 8px;
}

.header-metrics article {
  display: grid;
  gap: 3px;
  min-width: 128px;
  padding: 12px 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.055);
}

.header-metrics span {
  color: #91aabc;
  font-size: 10px;
  font-weight: 700;
}

.header-metrics strong {
  color: #f3c970;
  font-size: 15px;
}

.header-metrics strong.online {
  color: #57e0be;
}

.header-metrics small {
  max-width: 150px;
  overflow: hidden;
  color: #9bb2c3;
  font-size: 10px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-console {
  margin-top: 14px;
  padding: 17px;
  border: 1px solid rgba(50, 79, 107, 0.1);
  border-radius: 19px;
  background: rgba(255, 255, 255, 0.93);
  box-shadow: 0 11px 28px rgba(37, 64, 93, 0.07);
}

.console-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 12px;
  padding: 0 2px;
}

.console-heading span,
.mode-guide > div > span,
.model-toolbar span {
  color: #338c7b;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.console-heading h2 {
  margin: 4px 0 0;
  font-size: 22px;
}

.console-heading p {
  margin: 0;
  color: #748698;
  font-size: 12px;
}

.device-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.device-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 11px;
  padding: 13px;
  border: 1px solid #e1e9ef;
  border-radius: 14px;
  background: #f8fafb;
}

.device-card-heading {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.device-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: #177f6c;
  background: #e4f5f0;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 8px;
  font-weight: 900;
}

.device-card-heading strong,
.device-card-heading small {
  display: block;
}

.device-card-heading strong {
  color: #244255;
  font-size: 14px;
}

.device-card-heading small {
  margin-top: 2px;
  color: #8596a5;
  font-size: 10px;
}

.device-card-heading i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a6b3be;
}

.device-card-heading i.online {
  background: #26bd95;
  box-shadow: 0 0 9px rgba(38, 189, 149, 0.55);
}

.device-fields {
  display: grid;
  grid-template-columns: 1.35fr 0.8fr;
  gap: 7px;
}

.device-fields label,
.threshold-setting {
  display: grid;
  gap: 4px;
  color: #708494;
  font-size: 11px;
  font-weight: 700;
}

.device-fields select {
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid #d8e3ea;
  border-radius: 9px;
  outline: none;
  color: #244255;
  background: #fff;
  font-size: 12px;
}

.port-actions {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr;
  gap: 7px;
}

.port-actions > button {
  min-height: 36px;
  padding-block: 8px;
}

.calibration-summary {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 9px;
  padding: 9px 10px;
  border-radius: 10px;
  background: #eef4f7;
}

.calibration-summary span {
  color: #7b8e9e;
  font-size: 10px;
}

.calibration-summary strong {
  justify-self: end;
  color: #bf8c23;
  font-size: 12px;
}

.calibration-ready .calibration-summary strong {
  color: #16866f;
}

.calibration-collecting .calibration-summary strong {
  color: #2f7fb7;
}

.calibration-summary small {
  grid-column: 1 / 3;
  color: #778b9c;
  font-size: 10px;
}

.threshold-setting > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.threshold-setting b {
  color: #1c806c;
  font-size: 15px;
}

.threshold-setting input {
  width: 100%;
  accent-color: #32baa0;
}

.threshold-mode-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 8px;
  padding: 4px;
  border: 1px solid #d8e2e8;
  border-radius: 10px;
  background: #eef3f5;
}

.threshold-mode-selector button {
  min-height: 34px;
  border: 0;
  border-radius: 7px;
  color: #64798a;
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.threshold-mode-selector button.active {
  color: #0e5548;
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(28, 68, 60, 0.1);
}

.calibrated-threshold-panel {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.calibrated-threshold-panel > div {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid #d8e5e8;
  border-radius: 9px;
  background: #f5faf9;
}

.calibrated-threshold-panel span,
.calibrated-threshold-panel small {
  color: #718494;
  font-size: 10px;
}

.calibrated-threshold-panel strong {
  color: #167a67;
  font-size: 14px;
}

.calibrated-threshold-panel .threshold-config-error {
  color: #a0444c;
}

.device-note {
  margin: 0;
  color: #8192a1;
  font-size: 10px;
  line-height: 1.55;
}

.workflow-nav {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
  padding: 8px;
  border: 1px solid rgba(50, 79, 107, 0.1);
  border-radius: 17px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 11px 26px rgba(37, 64, 93, 0.065);
}

.workflow-step {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  color: #4a6072;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.workflow-step:hover {
  background: #f3f8fa;
}

.workflow-step.active {
  color: #13372f;
  border-color: #93e2d0;
  background: #eafaf5;
}

.workflow-number {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: #728798;
  background: #e9eff3;
  font-size: 10px;
  font-weight: 900;
}

.workflow-step.active .workflow-number {
  color: #062b24;
  background: #54ddbc;
}

.workflow-step strong,
.workflow-step small {
  display: block;
}

.workflow-step strong {
  font-size: 14px;
}

.workflow-step small {
  margin-top: 2px;
  color: #8495a4;
  font-size: 10px;
}

.workflow-step em {
  color: #8495a4;
  font-size: 10px;
  font-style: normal;
  white-space: nowrap;
}

.workflow-step.active em {
  color: #12846d;
  font-weight: 800;
}

.mode-guide {
  display: grid;
  grid-template-columns: minmax(260px, 0.72fr) minmax(0, 1.28fr);
  align-items: center;
  gap: 24px;
  margin-top: 12px;
  padding: 15px 17px;
  border: 1px solid #dbe7ed;
  border-radius: 16px;
  background:
    linear-gradient(110deg, rgba(238, 249, 246, 0.96), rgba(248, 251, 252, 0.96));
}

.mode-guide h2 {
  margin: 4px 0 4px;
  font-size: 21px;
}

.mode-guide p {
  margin: 0;
  color: #6d8293;
  font-size: 12px;
}

.mode-guide ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mode-guide li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 9px;
  border-radius: 10px;
  color: #52697b;
  background: rgba(255, 255, 255, 0.76);
  font-size: 11px;
}

.mode-guide li b {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  color: #167c68;
  background: #e1f4ef;
  font-size: 10px;
}

.serial-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 9px;
  max-width: 700px;
}

.connection-state {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 2px 8px;
  min-width: 180px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.connection-state i {
  grid-row: 1 / 3;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #8999aa;
}

.connection-state.active i {
  background: #49e1b9;
  box-shadow: 0 0 12px #49e1b9;
}

.connection-state span {
  font-size: 12px;
  font-weight: 800;
}

.connection-state small {
  color: #a5bbce;
  font-size: 9px;
}

.calibration-state {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 2px 8px;
  min-width: 190px;
  padding: 9px 10px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.calibration-state span {
  color: #a5bbce;
  font-size: 9px;
}

.calibration-state strong {
  justify-self: end;
  color: #f0c86c;
  font-size: 10px;
}

.calibration-state.ready strong {
  color: #54e2bd;
}

.calibration-state.collecting strong {
  color: #8fc9ff;
}

.calibration-state small {
  grid-column: 1 / 3;
  color: #a5bbce;
  font-size: 8px;
}

.calibration-state button {
  grid-column: 1 / 3;
  min-height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  color: #e5f3fb;
  background: rgba(255, 255, 255, 0.08);
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
}

.calibration-state button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.serial-panel label,
.answer-field {
  display: grid;
  gap: 4px;
  color: #a5bbce;
  font-size: 9px;
}

.serial-panel select,
.answer-field input {
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  color: #f6fbff;
  background: rgba(255, 255, 255, 0.08);
}

.serial-panel option {
  color: #172538;
}

.mode-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 26px rgba(38, 63, 87, 0.08);
}

.mode-tabs button {
  padding: 9px 15px;
  border: 1px solid #dce5ec;
  border-radius: 10px;
  color: #506578;
  background: #fff;
  font-weight: 700;
  cursor: pointer;
}

.mode-tabs button.active {
  color: #062c25;
  border-color: #54dfbd;
  background: #61e5c2;
}

.threshold-control {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: auto;
  color: #62778b;
  font-size: 10px;
}

.threshold-control input {
  width: 130px;
}

.training-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.14fr) minmax(430px, 0.86fr);
  gap: 16px;
  margin-top: 12px;
}

.model-card,
.content-panel {
  overflow: hidden;
  border: 1px solid rgba(55, 86, 113, 0.1);
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 14px 32px rgba(36, 65, 91, 0.08);
}

.model-card {
  position: relative;
  min-height: 710px;
  padding: 10px;
}

.model-toolbar {
  position: absolute;
  top: 22px;
  right: 22px;
  left: 22px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 13px;
  border: 1px solid rgba(49, 91, 119, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 8px 20px rgba(40, 71, 93, 0.08);
  backdrop-filter: blur(10px);
  pointer-events: none;
}

.model-toolbar strong,
.model-toolbar span {
  display: block;
}

.model-toolbar strong {
  margin-top: 2px;
  color: #2d4a5f;
  font-size: 14px;
}

.model-toolbar small {
  padding: 5px 8px;
  border-radius: 999px;
  color: #1c806c;
  background: #e4f6f1;
  font-size: 10px;
  font-weight: 800;
}

.sensor-strip {
  position: absolute;
  right: 18px;
  bottom: 16px;
  left: 18px;
  display: grid;
  grid-template-columns: repeat(15, 1fr);
  gap: 3px;
  padding: 8px;
  border-radius: 12px;
  background: rgba(15, 34, 50, 0.88);
}

.sensor-strip span {
  padding: 4px 0;
  color: #91a9ba;
  border-radius: 5px;
  font-size: 9px;
  text-align: center;
  background: rgba(255, 255, 255, 0.07);
}

.sensor-strip span.active {
  color: #072a24;
  background: #52dfbc;
}

.content-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 710px;
  padding: 20px;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.panel-heading h2 {
  margin: 4px 0 0;
  font-size: 24px;
}

.panel-heading b {
  padding: 6px 9px;
  border-radius: 999px;
  color: #557286;
  background: #edf3f7;
  font-size: 12px;
}

.point-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.point-grid button,
.checklist button,
.no-touch-row button {
  padding: 9px 10px;
  border: 1px solid #e0e8ee;
  border-radius: 10px;
  color: #465c6f;
  background: #f9fbfc;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.point-grid button span,
.checklist button span {
  margin-right: 5px;
  color: #15947c;
  font-weight: 800;
}

.point-grid button.active,
.no-touch-row button.active {
  border-color: #4bd7b6;
  background: #ecfbf6;
}

.no-touch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.no-touch-row button {
  display: flex;
  justify-content: space-between;
  color: #9c3d3d;
  background: #fff4f4;
  border-color: #f1cccc;
}

.no-touch-row small {
  font-weight: 800;
}

.detail-card,
.prompt-card,
.exam-card,
.announcement-card,
.result-card {
  padding: 17px;
  border-radius: 15px;
  background: #f5f8fa;
}

.detail-card.danger {
  color: #7d2f2f;
  background: #fff0f0;
}

.detail-card h2,
.prompt-card h2,
.exam-card h2 {
  margin: 6px 0 8px;
  font-size: 22px;
}

.detail-card p,
.prompt-card p,
.exam-card p,
.announcement-card p,
.result-card p {
  color: #62778a;
  font-size: 13px;
  line-height: 1.7;
}

.detail-card h3 {
  margin: 10px 0 5px;
  font-size: 14px;
}

.detail-card ul {
  margin: 0;
  padding-left: 18px;
  color: #62778a;
  font-size: 12px;
}

.primary-button,
.secondary-button,
.text-button {
  padding: 9px 15px;
  border: 0;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.primary-button {
  color: #082821;
  background: #56dfbd;
}

.secondary-button {
  color: #dcebf5;
  background: #334e62;
}

.text-button {
  color: #197a68;
  background: transparent;
}

.wide {
  width: 100%;
}

.session-intro {
  display: grid;
  gap: 12px;
  padding: 17px;
  border: 1px solid #dce8ee;
  border-radius: 15px;
  background:
    linear-gradient(145deg, #f7fbfc, #eef8f5);
}

.session-intro > span {
  color: #318b78;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.session-intro h3 {
  margin: 0;
  color: #274458;
  font-size: 20px;
}

.session-intro p {
  margin: 0;
  color: #6f8495;
  font-size: 12px;
  line-height: 1.7;
}

.session-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.session-facts div {
  display: grid;
  gap: 2px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.75);
}

.session-facts b {
  color: #178a72;
  font-size: 20px;
}

.session-facts small {
  color: #8193a2;
  font-size: 10px;
}

.exam-intro {
  background:
    linear-gradient(145deg, #f8f9fc, #eef3fa);
}

.exam-intro > span,
.exam-intro .session-facts b {
  color: #4475a6;
}

.training-progress {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #6b8092;
  font-size: 12px;
}

.prompt-card strong,
.exam-card strong {
  display: block;
  margin-top: 8px;
  color: #b54d4d;
  font-size: 13px;
}

.answer-review {
  display: grid;
  gap: 9px;
  padding: 13px;
  border: 1px solid #cddfe9;
  border-radius: 13px;
  background: #f3f8fb;
}

.answer-review strong {
  color: #31546a;
  font-size: 13px;
}

.answer-review .answer-field {
  color: #62778a;
}

.exam-card .answer-field {
  margin-top: 10px;
  color: #62778a;
}

.answer-reveal {
  margin-top: 10px;
  padding: 10px;
  border-left: 3px solid #f06a6a;
  color: #9b3737;
  background: #fff1f1;
  font-size: 13px;
}

.answer-reveal p {
  margin: 4px 0 0;
}

.progress-bar {
  height: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: #e6edf2;
}

.progress-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f7cf6, #4ed9b7);
  transition: width 0.3s ease;
}

.progress-copy {
  margin: -4px 0 0;
  color: #718497;
  font-size: 10px;
}

.checklist {
  display: grid;
  grid-template-columns: 1fr;
  gap: 5px;
  max-height: 370px;
  overflow-y: auto;
}

.checklist button {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  align-items: center;
}

.checklist button b {
  color: #8b9baa;
  font-size: 9px;
}

.checklist button.done {
  color: #187d68;
  border-color: #b9eadf;
  background: #effbf7;
}

.checklist button.done b {
  color: #16886e;
}

.checklist .no-touch-item {
  color: #994141;
  background: #fff6f6;
}

.answer-field input {
  width: 100%;
  color: #172538;
  background: #fff;
}

.exam-results {
  display: grid;
  gap: 5px;
  max-height: 240px;
  overflow-y: auto;
}

.exam-results div {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  padding: 8px;
  border-radius: 9px;
  background: #f4f8fa;
  font-size: 9px;
}

.exam-results small {
  grid-column: 1 / -1;
  color: #a05252;
  font-size: 9px;
}

.result-card {
  text-align: center;
}

.result-card strong {
  display: block;
  color: #158b73;
  font-size: 54px;
  line-height: 1.2;
}

.announcement-card {
  margin-top: auto;
  border: 1px solid #dbe8ef;
  background: #f4f9fb;
}

.announcement-card p {
  margin: 7px 0 0;
}

.result-save-state {
  margin: 10px 0 0;
  padding: 9px 11px;
  border-radius: 9px;
  color: #526d7d;
  background: #edf3f6;
  font-size: 11px;
  line-height: 1.5;
}

.result-save-state.saved {
  color: #176f5e;
  background: #eaf8f4;
}

.result-save-state.error {
  color: #9b4149;
  background: #fff0f1;
}

@media (max-width: 1250px) {
  .training-header {
    grid-template-columns: 1fr;
  }

  .header-metrics {
    width: 100%;
  }

  .device-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .device-card:last-child {
    grid-column: 1 / -1;
  }

  .workflow-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .training-workspace {
    grid-template-columns: 1fr;
  }

  .model-card {
    min-height: 520px;
  }
}

@media (max-width: 820px) {
  .device-grid,
  .mode-guide {
    grid-template-columns: 1fr;
  }

  .device-card:last-child {
    grid-column: auto;
  }

  .console-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .mode-guide ol {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .training-page {
    padding: 10px;
  }

  .training-header {
    padding: 20px;
  }

  .header-metrics,
  .workflow-nav {
    grid-template-columns: 1fr;
  }

  .device-fields {
    grid-template-columns: 1fr;
  }

  .workflow-step em {
    display: none;
  }

  .point-grid {
    grid-template-columns: 1fr;
  }

  .model-toolbar {
    top: 16px;
    right: 16px;
    left: 16px;
  }
}
</style>
