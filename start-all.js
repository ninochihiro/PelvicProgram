import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'

const PORT_SERVER = 8080
const PORT_FRONTEND = 5173
const viteEntry = path.resolve('node_modules/vite/bin/vite.js')

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(700)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => {
      resolve(false)
    })
  })
}

const [serverRunning, frontendRunning] = await Promise.all([
  isPortListening(PORT_SERVER),
  isPortListening(PORT_FRONTEND)
])

if (serverRunning && frontendRunning) {
  console.log('上位机已经在运行，请直接访问 http://localhost:5173')
  process.exit(0)
}

if (serverRunning || frontendRunning) {
  console.error(
    `检测到服务只启动了一部分（8080: ${
      serverRunning ? '已占用' : '未启动'
    }，5173: ${frontendRunning ? '已占用' : '未启动'}）。`
  )
  console.error(
    '为避免端口冲突，本次不会继续启动。请先运行“停止上位机.bat”，再运行“启动上位机.bat”。'
  )
  process.exit(1)
}

const children = [
  spawn(process.execPath, ['server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, [viteEntry], { stdio: 'inherit' })
]

let shuttingDown = false

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) child.kill()
  }

  setTimeout(() => process.exit(exitCode), 200)
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('串口服务和 Vite 已启动。按 Ctrl+C 可同时停止。')
