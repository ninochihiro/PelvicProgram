import { execFileSync } from 'node:child_process'

const targetPorts = new Set([5173, 8080])
const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
  encoding: 'utf8'
})

const processIds = new Set()

for (const line of output.split(/\r?\n/)) {
  const match = line.match(/:(5173|8080)\s+\S+\s+LISTENING\s+(\d+)/i)
  if (match && targetPorts.has(Number(match[1]))) {
    processIds.add(Number(match[2]))
  }
}

if (!processIds.size) {
  console.log('没有发现正在运行的上位机服务。')
  process.exit(0)
}

for (const processId of processIds) {
  try {
    process.kill(processId)
    console.log(`已停止进程 ${processId}`)
  } catch {
    console.log(`进程 ${processId} 已结束或无法访问`)
  }
}
