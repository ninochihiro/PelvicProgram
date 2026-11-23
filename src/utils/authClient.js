import { reactive } from 'vue'

const TOKEN_KEY = 'mpps-auth-token'

export const authState = reactive({
  user: null,
  ready: false,
  loading: false,
  error: ''
})

let restorePromise = null

export function getAuthToken() {
  return window.localStorage.getItem(TOKEN_KEY)
}

function setAuthToken(token) {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(TOKEN_KEY)
  }
}

function clearSession() {
  setAuthToken(null)
  authState.user = null
}

async function parseResponse(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    if (response.status === 401) clearSession()
    throw new Error(payload?.error || `请求失败 (${response.status})`)
  }

  return payload
}

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  const token = getAuthToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, {
    ...options,
    headers
  })
  return parseResponse(response)
}

export async function restoreSession() {
  if (restorePromise) return restorePromise

  restorePromise = (async () => {
    const token = getAuthToken()
    if (!token) {
      authState.user = null
      authState.ready = true
      return null
    }

    try {
      const payload = await requestJson('/api/auth/session')
      authState.user = payload.user
      return payload.user
    } catch {
      clearSession()
      return null
    } finally {
      authState.ready = true
    }
  })()

  return restorePromise
}

export async function login({ username, password, role }) {
  authState.loading = true
  authState.error = ''
  try {
    const payload = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, role })
    })
    setAuthToken(payload.token)
    authState.user = payload.user
    authState.ready = true
    return payload.user
  } catch (error) {
    authState.error = error.message
    throw error
  } finally {
    authState.loading = false
  }
}

export async function logout() {
  try {
    if (getAuthToken()) {
      await requestJson('/api/auth/logout', { method: 'POST' })
    }
  } finally {
    clearSession()
  }
}

export async function listUsers() {
  const payload = await requestJson('/api/admin/users')
  return payload.users
}

export async function createUser(user) {
  const payload = await requestJson('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(user)
  })
  return payload.user
}

export async function updateUser(id, updates) {
  const payload = await requestJson(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  })
  return payload.user
}

export async function deleteUser(id) {
  return requestJson(`/api/admin/users/${id}`, {
    method: 'DELETE'
  })
}

export async function getNetworkInfo() {
  return requestJson('/api/network-info')
}

export async function getTouchThresholdConfig() {
  return requestJson('/api/calibration/touch-thresholds')
}

export async function saveTouchThresholdConfig(config) {
  return requestJson('/api/calibration/touch-thresholds', {
    method: 'PUT',
    body: JSON.stringify({ config })
  })
}
