import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import { WebSocket, WebSocketServer } from 'ws'
import {
  PRESSURE_GAUGE_BAUD,
  PRESSURE_GAUGE_START_COMMAND,
  extractPressureFrames,
  parsePressureFrame
} from './src/utils/pressureGauge.js'
import {
  TOUCH_THRESHOLD_VERSION,
  normalizeTouchThresholdState
} from './src/utils/touchThresholdCalibration.js'

const PORT = 8080
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(APP_ROOT, 'data')
const USERS_FILE = path.join(DATA_DIR, 'auth-users.json')
const TOUCH_THRESHOLDS_FILE = path.join(
  DATA_DIR,
  'touch-thresholds.json'
)
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 5 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 8
const VALID_ROLES = new Set(['user', 'admin'])
const DEFAULT_ADMIN_USERNAME =
  process.env.PELVIC_ADMIN_USERNAME?.trim() || 'admin'
const DEFAULT_ADMIN_PASSWORD =
  process.env.PELVIC_ADMIN_PASSWORD || '123'

const users = []
const sessions = new Map()
const loginAttempts = new Map()

const serialChannels = {
  sensor: {
    port: null,
    parser: null,
    owner: null,
    receivedCount: 0,
    buffer: Buffer.alloc(0)
  },
  pressure: {
    port: null,
    parser: null,
    owner: null,
    receivedCount: 0,
    buffer: Buffer.alloc(0)
  }
}
let createdDefaultAdmin = false

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase()
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return {
    salt,
    passwordHash: scryptSync(password, salt, 64).toString('hex')
  }
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false
  const expected = Buffer.from(user.passwordHash, 'hex')
  const actual = scryptSync(password, user.salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt
  }
}

function createUserRecord({
  username,
  password,
  displayName,
  role = 'user'
}) {
  const now = new Date().toISOString()
  const credential = hashPassword(password)
  return {
    id: randomBytes(12).toString('hex'),
    username: normalizeUsername(username),
    displayName: String(displayName ?? username).trim() || username,
    role,
    ...credential,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null
  }
}

async function persistUsers() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tempPath = `${USERS_FILE}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(users, null, 2), 'utf8')
  await fs.rename(tempPath, USERS_FILE)
}

async function persistTouchThresholdConfig(config) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tempPath = `${TOUCH_THRESHOLDS_FILE}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf8')
  await fs.rename(tempPath, TOUCH_THRESHOLDS_FILE)
}

async function initializeAuthStore() {
  await fs.mkdir(DATA_DIR, { recursive: true })

  try {
    const content = await fs.readFile(USERS_FILE, 'utf8')
    const storedUsers = JSON.parse(content)
    if (Array.isArray(storedUsers)) {
      users.push(
        ...storedUsers.filter(
          (user) =>
            user?.id &&
            user?.username &&
            user?.passwordHash &&
            user?.salt &&
            VALID_ROLES.has(user.role)
        )
      )
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`账号数据读取失败，将重新初始化: ${error.message}`)
    }
  }

  if (!users.some((user) => user.role === 'admin')) {
    const username = normalizeUsername(DEFAULT_ADMIN_USERNAME)
    const existing = users.find((user) => user.username === username)
    if (existing) {
      existing.role = 'admin'
      existing.displayName = existing.displayName || '系统管理员'
      existing.updatedAt = new Date().toISOString()
    } else {
      users.push(
        createUserRecord({
          username,
          password: DEFAULT_ADMIN_PASSWORD,
          displayName: '系统管理员',
          role: 'admin'
        })
      )
      createdDefaultAdmin = true
    }
    await persistUsers()
  }
}

function createSession(user) {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, {
    userId: user.id,
    expiresAt: Date.now() + SESSION_TTL_MS
  })
  return token
}

function getTokenFromRequest(request) {
  const authorization = String(request.headers.authorization ?? '')
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim()
  }
  const url = new URL(request.url, 'http://localhost')
  return url.searchParams.get('token')
}

function authenticateToken(token) {
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }

  const user = users.find((item) => item.id === session.userId)
  if (!user) {
    sessions.delete(token)
    return null
  }

  return { user, token }
}

function getAuthenticatedRequest(request) {
  return authenticateToken(getTokenFromRequest(request))
}

function getLocalNetworkAddresses() {
  const addresses = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address)
      }
    }
  }
  return [...new Set(addresses)]
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) {
      throw new Error('请求内容过大')
    }
    chunks.push(chunk)
  }

  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function validatePassword(password) {
  if (String(password ?? '').length < 8) {
    throw new Error('密码长度至少为 8 位')
  }
}

function validateUsername(username) {
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new Error('用户名需为 3-32 位字母、数字、点、下划线或连字符')
  }
}

function getLoginAttemptKey(request, username) {
  return `${request.socket.remoteAddress ?? 'local'}:${normalizeUsername(username)}`
}

function checkLoginRateLimit(key) {
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  if (current.count >= MAX_LOGIN_ATTEMPTS) {
    throw new Error('登录尝试过多，请 5 分钟后重试')
  }
}

function recordFailedLogin(key) {
  const current = loginAttempts.get(key)
  if (!current) return
  current.count += 1
}

async function handleLogin(request, response) {
  const body = await readJsonBody(request)
  const username = normalizeUsername(body.username)
  const password = String(body.password ?? '')
  const requestedRole = String(body.role ?? 'user')
  const key = getLoginAttemptKey(request, username)

  checkLoginRateLimit(key)

  const user = users.find((item) => item.username === username)
  if (!user || !verifyPassword(password, user) || user.role !== requestedRole) {
    recordFailedLogin(key)
    sendJson(response, 401, {
      error:
        requestedRole === 'admin'
          ? '管理员账号或密码不正确'
          : '用户账号或密码不正确'
    })
    return
  }

  loginAttempts.delete(key)
  user.lastLoginAt = new Date().toISOString()
  await persistUsers()
  const token = createSession(user)

  sendJson(response, 200, {
    token,
    user: publicUser(user)
  })
}

function requireAdmin(request, response) {
  const auth = getAuthenticatedRequest(request)
  if (!auth) {
    sendJson(response, 401, { error: '登录状态已失效，请重新登录' })
    return null
  }
  if (auth.user.role !== 'admin') {
    sendJson(response, 403, { error: '当前账号没有管理员权限' })
    return null
  }
  return auth
}

async function handleAdminUsers(request, response, pathname) {
  const auth = requireAdmin(request, response)
  if (!auth) return

  if (pathname === '/api/admin/users' && request.method === 'GET') {
    sendJson(response, 200, {
      users: users
        .map(publicUser)
        .sort((a, b) => a.username.localeCompare(b.username, 'zh-CN'))
    })
    return
  }

  if (pathname === '/api/admin/users' && request.method === 'POST') {
    const body = await readJsonBody(request)
    const username = normalizeUsername(body.username)
    validateUsername(username)
    validatePassword(body.password)

    if (users.some((user) => user.username === username)) {
      sendJson(response, 409, { error: '该用户名已存在' })
      return
    }

    const role = VALID_ROLES.has(body.role) ? body.role : 'user'
    const user = createUserRecord({
      username,
      password: String(body.password),
      displayName: body.displayName,
      role
    })
    users.push(user)
    await persistUsers()
    sendJson(response, 201, { user: publicUser(user) })
    return
  }

  const match = pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (!match) {
    sendJson(response, 404, { error: '接口不存在' })
    return
  }

  const user = users.find((item) => item.id === match[1])
  if (!user) {
    sendJson(response, 404, { error: '用户不存在' })
    return
  }

  if (request.method === 'PATCH') {
    const body = await readJsonBody(request)
    const nextRole = VALID_ROLES.has(body.role) ? body.role : user.role
    const roleChanged = nextRole !== user.role
    const adminCount = users.filter((item) => item.role === 'admin').length
    const currentToken = getTokenFromRequest(request)

    if (user.role === 'admin' && nextRole !== 'admin' && adminCount <= 1) {
      sendJson(response, 409, { error: '系统必须至少保留一个管理员' })
      return
    }

    if (body.displayName !== undefined) {
      user.displayName = String(body.displayName).trim() || user.displayName
    }
    if (body.password) {
      validatePassword(body.password)
      Object.assign(user, hashPassword(String(body.password)))
    }
    user.role = nextRole
    user.updatedAt = new Date().toISOString()
    if (body.password || roleChanged) {
      for (const [token, session] of sessions) {
        if (session.userId === user.id && token !== currentToken) {
          sessions.delete(token)
        }
      }
    }
    await persistUsers()
    sendJson(response, 200, { user: publicUser(user) })
    return
  }

  if (request.method === 'DELETE') {
    if (user.id === auth.user.id) {
      sendJson(response, 409, { error: '不能删除当前登录账号' })
      return
    }
    const adminCount = users.filter((item) => item.role === 'admin').length
    if (user.role === 'admin' && adminCount <= 1) {
      sendJson(response, 409, { error: '系统必须至少保留一个管理员' })
      return
    }

    users.splice(users.indexOf(user), 1)
    for (const [token, session] of sessions) {
      if (session.userId === user.id) sessions.delete(token)
    }
    await persistUsers()
    sendJson(response, 200, { success: true })
    return
  }

  sendJson(response, 405, { error: '请求方法不支持' })
}

async function handleHttpRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
  const pathname = url.pathname

  try {
    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, { ok: true, service: 'mpps-local-server' })
      return
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      await handleLogin(request, response)
      return
    }

    if (request.method === 'GET' && pathname === '/api/auth/session') {
      const auth = getAuthenticatedRequest(request)
      if (!auth) {
        sendJson(response, 401, { error: '未登录或登录已过期' })
        return
      }
      sendJson(response, 200, { user: publicUser(auth.user) })
      return
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const token = getTokenFromRequest(request)
      if (token) sessions.delete(token)
      sendJson(response, 200, { success: true })
      return
    }

    if (request.method === 'GET' && pathname === '/api/serial/ports') {
      const auth = getAuthenticatedRequest(request)
      if (!auth) {
        sendJson(response, 401, { error: '登录状态已失效，请重新登录' })
        return
      }
      const ports = await SerialPort.list()
      sendJson(response, 200, { ports })
      return
    }

    if (request.method === 'GET' && pathname === '/api/network-info') {
      const auth = getAuthenticatedRequest(request)
      if (!auth) {
        sendJson(response, 401, { error: '登录状态已失效，请重新登录' })
        return
      }
      sendJson(response, 200, {
        addresses: getLocalNetworkAddresses(),
        ports: {
          frontend: 5173,
          server: PORT
        }
      })
      return
    }

    if (
      request.method === 'GET' &&
      pathname === '/api/calibration/touch-thresholds'
    ) {
      const auth = getAuthenticatedRequest(request)
      if (!auth) {
        sendJson(response, 401, { error: '登录状态已失效，请重新登录' })
        return
      }

      try {
        const storedConfig = JSON.parse(
          await fs.readFile(TOUCH_THRESHOLDS_FILE, 'utf8')
        )
        const config = normalizeTouchThresholdState(storedConfig)
        const migrated =
          Number(storedConfig.version) !== TOUCH_THRESHOLD_VERSION
        const responseConfig = storedConfig.updatedBy
          ? { ...config, updatedBy: storedConfig.updatedBy }
          : config
        if (migrated) {
          await persistTouchThresholdConfig(responseConfig)
        }
        sendJson(response, 200, { config: responseConfig })
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
        sendJson(response, 200, { config: null })
      }
      return
    }

    if (
      request.method === 'PUT' &&
      pathname === '/api/calibration/touch-thresholds'
    ) {
      const auth = getAuthenticatedRequest(request)
      if (!auth) {
        sendJson(response, 401, { error: '登录状态已失效，请重新登录' })
        return
      }
      if (auth.user.role !== 'admin') {
        sendJson(response, 403, { error: '只有管理员可以修改触诊阈值' })
        return
      }

      const body = await readJsonBody(request)
      if (!body?.config || typeof body.config !== 'object') {
        sendJson(response, 400, { error: '触诊阈值配置格式不正确' })
        return
      }
      const config = normalizeTouchThresholdState(body.config)
      await persistTouchThresholdConfig({
        ...config,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.user.username
      })
      sendJson(response, 200, { success: true })
      return
    }

    if (pathname.startsWith('/api/admin/')) {
      await handleAdminUsers(request, response, pathname)
      return
    }

    sendJson(response, 404, { error: '接口不存在' })
  } catch (error) {
    sendJson(response, 400, { error: error.message || '请求处理失败' })
  }
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function broadcast(payload) {
  const message = JSON.stringify(payload)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}

function channelMessageType(channelName, suffix) {
  return channelName === 'pressure' ? `pressure-${suffix}` : suffix
}

function closeSerialChannel(channelName) {
  const channel = serialChannels[channelName]
  const port = channel.port

  if (channel.parser && port) {
    port.unpipe(channel.parser)
    channel.parser.destroy()
  }

  channel.port = null
  channel.parser = null
  channel.owner = null
  channel.receivedCount = 0
  channel.buffer = Buffer.alloc(0)

  if (!port) return Promise.resolve()
  return new Promise((resolve) => {
    if (!port.isOpen) {
      resolve()
      return
    }
    port.close(() => resolve())
  })
}

async function closePortsForOwner(ws) {
  const tasks = []
  for (const [channelName, channel] of Object.entries(serialChannels)) {
    if (channel.owner === ws) tasks.push(closeSerialChannel(channelName))
  }
  await Promise.all(tasks)
}

function consumePressureData(channel, chunk) {
  const extracted = extractPressureFrames(channel.buffer, chunk)
  channel.buffer = extracted.buffer

  for (const frame of extracted.frames) {
    try {
      const forceN = parsePressureFrame(frame)
      channel.receivedCount += 1
      broadcast({
        type: 'pressure-data',
        forceN,
        unit: 'N',
        frameHex: frame.toString('hex').toUpperCase(),
        timestamp: Date.now()
      })
    } catch (error) {
      console.warn(`压力计帧解析失败: ${error.message}`)
    }
  }
}

function openSerialChannel(
  ws,
  channelName,
  portPath,
  baudRate,
  { pressureProtocol = false } = {}
) {
  return closeSerialChannel(channelName).then(() => {
    const channel = serialChannels[channelName]
    channel.owner = ws
    channel.receivedCount = 0
    channel.buffer = Buffer.alloc(0)

    const port = new SerialPort({
      path: portPath,
      baudRate:
        Number(baudRate) ||
        (pressureProtocol ? PRESSURE_GAUGE_BAUD : 460800),
      autoOpen: false,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: false,
      xon: false,
      xoff: false,
      xany: false,
      flowControl: false,
      dtr: true,
      rts: true
    })

    channel.port = port
    port.on('error', (error) => {
      send(ws, {
        type: channelMessageType(channelName, 'error'),
        channel: channelName,
        error: `串口错误: ${error.message}`
      })
    })

    port.open((error) => {
      if (error) {
        send(ws, {
          type: channelMessageType(channelName, 'error'),
          channel: channelName,
          error: `打开串口失败: ${error.message}`
        })
        if (channel.port === port) {
          channel.port = null
          channel.owner = null
        }
        return
      }

      console.log(
        `${channelName === 'pressure' ? '压力计' : '传感器'}串口已打开: ${portPath} @ ${port.baudRate}`
      )

      if (pressureProtocol) {
        port.on('data', (chunk) => consumePressureData(channel, chunk))

        setTimeout(() => {
          if (channel.port !== port || !port.isOpen) return
          for (let index = 0; index < 3; index++) {
            setTimeout(() => {
              if (channel.port === port && port.isOpen) {
                port.write(Buffer.from([PRESSURE_GAUGE_START_COMMAND]))
              }
            }, index * 200)
          }
        }, 1500)

        send(ws, {
          type: 'pressure-connect-success',
          channel: channelName,
          port: portPath,
          baudRate: port.baudRate
        })
        return
      }

      channel.parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))
      channel.parser.on('data', (line) => {
        const text = String(line).trim()
        if (!text) return

        const tokens = text.split(/[,\s]+/).filter(Boolean)
        if (tokens.length < 15 || tokens.length > 16) return

        const values = tokens.slice(0, 15).map(Number)
        if (
          values.some(
            (value) => !Number.isFinite(value) || value < 0 || value > 65535
          )
        ) {
          return
        }

        channel.receivedCount += 1
        if (
          channel.receivedCount === 1 ||
          channel.receivedCount % 100 === 0
        ) {
          console.log(
            `传感器帧 ${channel.receivedCount}: ${text.slice(0, 120)}`
          )
        }

        broadcast({
          type: 'data',
          data: text,
          values,
          timestamp: Date.now()
        })
      })

      send(ws, {
        type: 'connect-success',
        channel: channelName,
        port: portPath,
        baudRate: port.baudRate
      })
    })
  })
}

await initializeAuthStore()

const httpServer = createServer((request, response) => {
  handleHttpRequest(request, response)
})
const wss = new WebSocketServer({ server: httpServer })

function handleServerStartupError(error) {
  if (error.code === 'EADDRINUSE') {
    console.error(
      '端口 8080 已被占用，系统可能已经启动。请直接访问 http://localhost:5173；' +
        '如需重启，请先运行“停止上位机.bat”，再运行“启动上位机.bat”。'
    )
  } else {
    console.error(`本地服务启动失败: ${error.message}`)
  }
  process.exit(1)
}

wss.on('error', handleServerStartupError)

wss.on('connection', (ws, request) => {
  const auth = authenticateToken(getTokenFromRequest(request))
  if (!auth) {
    ws.close(1008, 'Unauthorized')
    return
  }

  ws.authUser = auth.user
  console.log(`用户 ${auth.user.username} 已连接 WebSocket`)

  ws.on('message', async (rawMessage) => {
    let message
    try {
      message = JSON.parse(String(rawMessage))
    } catch {
      send(ws, { type: 'error', error: '无效的 WebSocket 消息' })
      return
    }

    try {
      switch (message.type) {
        case 'list-ports': {
          const ports = await SerialPort.list()
          send(ws, { type: 'ports-list', ports })
          break
        }

        case 'connect':
          if (!message.port) {
            send(ws, { type: 'error', error: '未指定串口' })
            break
          }
          openSerialChannel(ws, 'sensor', message.port, message.baudRate)
          break

        case 'disconnect':
          await closeSerialChannel('sensor')
          send(ws, { type: 'disconnect-success' })
          break

        case 'connect-pressure':
          if (!message.port) {
            send(ws, { type: 'pressure-error', error: '未指定压力计串口' })
            break
          }
          openSerialChannel(
            ws,
            'pressure',
            message.port,
            message.baudRate || PRESSURE_GAUGE_BAUD,
            { pressureProtocol: true }
          )
          break

        case 'disconnect-pressure':
          await closeSerialChannel('pressure')
          send(ws, { type: 'pressure-disconnect-success' })
          break
      }
    } catch (error) {
      send(ws, { type: 'error', error: error.message })
    }
  })

  ws.on('close', () => {
    console.log(`用户 ${auth.user.username} 已断开 WebSocket`)
    closePortsForOwner(ws)
  })
})

httpServer.on('error', handleServerStartupError)

httpServer.listen(PORT, () => {
  console.log(`账号与串口服务运行在端口 ${PORT}`)
  if (createdDefaultAdmin) {
    console.log(
      `已创建默认管理员: ${DEFAULT_ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}`
    )
    console.log('首次登录后请尽快创建其他账号并在部署环境中更换默认密码。')
  }
})

process.on('SIGINT', async () => {
  await Promise.all([
    closeSerialChannel('sensor'),
    closeSerialChannel('pressure')
  ])
  wss.close(() => httpServer.close(() => process.exit(0)))
})
