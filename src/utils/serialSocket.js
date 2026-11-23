import { getAuthToken } from './authClient'

export async function listSerialPorts() {
  const token = getAuthToken()
  const response = await fetch('/api/serial/ports', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(payload?.error || `读取串口失败 (${response.status})`)
  }

  return payload?.ports ?? []
}

export function createSerialSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = encodeURIComponent(getAuthToken() ?? '')
  return new WebSocket(
    `${protocol}//${window.location.host}/serial-ws?token=${token}`
  )
}
