export const painPoints = [
  {
    id: 'left-piriformis',
    channel: 0,
    code: 'A01',
    region: '左侧',
    title: '左侧梨状肌痛点',
    muscle: '梨状肌',
    nodes: ['piriformis_L'],
    origin: '起于骶骨前表面 S2-S4 骶前孔外侧缘，经坐骨大孔止于股骨大转子。',
    functions: ['髋关节外旋、外展和后伸', '维持骨盆稳定'],
    prompt: '请按压左侧梨状肌痛点'
  },
  {
    id: 'left-coccygeus',
    channel: 1,
    code: 'A02',
    region: '左侧',
    title: '左侧尾骨肌痛点',
    muscle: '尾骨肌',
    aliases: ['坐骨尾骨肌', '坐骨尾肌'],
    nodes: ['ischiococcygeus_L'],
    origin: '起于坐骨棘，止于尾骨和骶骨下部侧缘。',
    functions: ['构成盆底', '固定骶骨和尾骨', '辅助排便与分娩'],
    prompt: '请按压左侧尾骨肌痛点'
  },
  {
    id: 'left-iliococcygeus',
    channel: 2,
    code: 'A03',
    region: '左侧',
    title: '左侧髂尾肌痛点',
    muscle: '髂尾肌',
    nodes: ['iliococcygeus_L'],
    origin: '起于肛提肌腱弓后部和坐骨棘内侧，止于尾骨侧缘及肛尾韧带。',
    functions: ['支撑盆腔脏器', '参与排便控制', '维持盆底结构稳定'],
    prompt: '请按压左侧髂尾肌痛点'
  },
  {
    id: 'left-obturator-internus',
    channel: 3,
    code: 'A04',
    region: '左侧',
    title: '左侧闭孔内肌痛点',
    muscle: '闭孔内肌',
    nodes: ['internus_L'],
    origin: '起于闭孔膜内面及周围骨面，经坐骨小孔止于股骨转子窝。',
    functions: ['外旋和外展髋关节', '覆盖盆壁', '辅助维持排尿排便功能'],
    prompt: '请按压左侧闭孔内肌痛点'
  },
  {
    id: 'left-puborectalis',
    channel: 4,
    code: 'A05',
    region: '左侧',
    title: '左侧耻骨直肠肌痛点',
    muscle: '耻骨直肠肌',
    nodes: ['puborectalis_L'],
    origin: '起于耻骨联合后方和肛提肌腱弓前份，绕直肠后方形成 U 形环。',
    functions: ['控制排便', '维持肛门自制', '支撑盆底'],
    prompt: '请按压左侧耻骨直肠肌痛点'
  },
  {
    id: 'left-pubococcygeus',
    channel: 5,
    code: 'A06',
    region: '左侧',
    title: '左侧耻骨尾骨肌痛点',
    muscle: '耻骨尾骨肌',
    nodes: ['pubococcygeus_L'],
    origin: '起于耻骨降支内面和肛提肌腱弓前份，止于尾骨及肛尾韧带。',
    functions: ['支持和稳定盆腔器官', '协助排尿排便', '参与分娩过程'],
    prompt: '请按压左侧耻骨尾骨肌痛点'
  },
  {
    id: 'left-ischial-spine',
    channel: 6,
    code: 'A07',
    region: '左侧',
    title: '左侧坐骨棘痛点',
    muscle: '坐骨棘区域',
    nodes: ['Ischium_L'],
    origin: '坐骨棘位于坐骨后缘中部，是盆底重要骨性标志。',
    functions: ['定位肛提肌和尾骨肌', '参与盆底结构支撑'],
    prompt: '请按压左侧坐骨棘痛点'
  },
  {
    id: 'coccyx',
    channel: 7,
    code: 'A08',
    region: '中央',
    title: '尾骨痛点',
    muscle: '尾骨区域',
    nodes: ['Coccyx'],
    origin: '尾骨由 3-5 节退化的尾椎融合形成，是脊柱末端结构。',
    functions: ['提供盆底韧带附着', '参与盆底后部稳定'],
    prompt: '请按压尾骨痛点'
  },
  {
    id: 'right-piriformis',
    channel: 8,
    code: 'A09',
    region: '右侧',
    title: '右侧梨状肌痛点',
    muscle: '梨状肌',
    nodes: ['piriformis_R'],
    origin: '起于骶骨前表面 S2-S4 骶前孔外侧缘，经坐骨大孔止于股骨大转子。',
    functions: ['髋关节外旋、外展和后伸', '维持骨盆稳定'],
    prompt: '请按压右侧梨状肌痛点'
  },
  {
    id: 'right-coccygeus',
    channel: 9,
    code: 'A10',
    region: '右侧',
    title: '右侧尾骨肌痛点',
    muscle: '尾骨肌',
    aliases: ['坐骨尾骨肌', '坐骨尾肌'],
    nodes: ['ischiococcygeus_R'],
    origin: '起于坐骨棘，止于尾骨和骶骨下部侧缘。',
    functions: ['构成盆底', '固定骶骨和尾骨', '辅助排便与分娩'],
    prompt: '请按压右侧尾骨肌痛点'
  },
  {
    id: 'right-iliococcygeus',
    channel: 10,
    code: 'A11',
    region: '右侧',
    title: '右侧髂尾肌痛点',
    muscle: '髂尾肌',
    nodes: ['iliococcygeus_R'],
    origin: '起于肛提肌腱弓后部和坐骨棘内侧，止于尾骨侧缘及肛尾韧带。',
    functions: ['支撑盆腔脏器', '参与排便控制', '维持盆底结构稳定'],
    prompt: '请按压右侧髂尾肌痛点'
  },
  {
    id: 'right-obturator-internus',
    channel: 11,
    code: 'A12',
    region: '右侧',
    title: '右侧闭孔内肌痛点',
    muscle: '闭孔内肌',
    nodes: ['internus_R'],
    origin: '起于闭孔膜内面及周围骨面，经坐骨小孔止于股骨转子窝。',
    functions: ['外旋和外展髋关节', '覆盖盆壁', '辅助维持排尿排便功能'],
    prompt: '请按压右侧闭孔内肌痛点'
  },
  {
    id: 'right-puborectalis',
    channel: 12,
    code: 'A13',
    region: '右侧',
    title: '右侧耻骨直肠肌痛点',
    muscle: '耻骨直肠肌',
    nodes: ['puborectalis_R'],
    origin: '起于耻骨联合后方和肛提肌腱弓前份，绕直肠后方形成 U 形环。',
    functions: ['控制排便', '维持肛门自制', '支撑盆底'],
    prompt: '请按压右侧耻骨直肠肌痛点'
  },
  {
    id: 'right-pubococcygeus',
    channel: 13,
    code: 'A14',
    region: '右侧',
    title: '右侧耻骨尾骨肌痛点',
    muscle: '耻骨尾骨肌',
    nodes: ['pubococcygeus_R'],
    origin: '起于耻骨降支内面和肛提肌腱弓前份，止于尾骨及肛尾韧带。',
    functions: ['支持和稳定盆腔器官', '协助排尿排便', '参与分娩过程'],
    prompt: '请按压右侧耻骨尾骨肌痛点'
  },
  {
    id: 'right-ischial-spine',
    channel: 14,
    code: 'A15',
    region: '右侧',
    title: '右侧坐骨棘痛点',
    muscle: '坐骨棘区域',
    nodes: ['Ischium_R'],
    origin: '坐骨棘位于坐骨后缘中部，是盆底重要骨性标志。',
    functions: ['定位肛提肌和尾骨肌', '参与盆底结构支撑'],
    prompt: '请按压右侧坐骨棘痛点'
  }
]

export const noTouchRegions = [
  {
    id: 'urethra',
    title: '尿道区域',
    warning: '请勿按压',
    description: '尿道位于阴道之前、耻骨联合之后，自膀胱颈部向下止于尿道口，成人长度约 2-5 cm，平均约 3.5 cm。'
  },
  {
    id: 'rectum',
    title: '直肠肛管区域',
    warning: '请勿按压',
    description: '直肠肛管自乙状结肠末端开始，沿骶骨和尾骨前面下行并穿过盆膈，最终止于肛门，总长约 12-15 cm。'
  }
]

export const channelToPainPoint = Object.fromEntries(
  painPoints.map((point) => [point.channel, point])
)

export function getPainPointByChannel(channel) {
  return channelToPainPoint[channel] ?? null
}

function normalizeAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，,。.\-—_()（）[\]【】]/g, '')
    .replace(/(触痛点|痛点|肌肉|区域|位置)$/g, '')
}

export function sameAnswer(input, point) {
  if (!point) return false

  const normalized = normalizeAnswer(input)
  if (!normalized) return false

  const names = [point.muscle, ...(point.aliases ?? [])].filter(Boolean)
  const accepted = [point.code, point.title]

  if (point.region === '左侧' || point.region === '右侧') {
    accepted.push(...names.map((name) => `${point.region}${name}`))
  } else {
    accepted.push(
      ...names,
      ...names.map((name) => `${point.region}${name}`)
    )
  }

  const normalizedAccepted = new Set(accepted.map(normalizeAnswer))
  return normalizedAccepted.has(normalized)
}

export function sameNoTouchAnswer(input, region) {
  const normalized = normalizeAnswer(input)
  if (!normalized) return false

  const accepted = [region.title]
  if (region.id === 'urethra') accepted.push('尿道')
  if (region.id === 'rectum') {
    accepted.push('直肠', '直肠肛管', '肛门')
  }

  return accepted
    .map(normalizeAnswer)
    .some((answer) => answer === normalized)
}
