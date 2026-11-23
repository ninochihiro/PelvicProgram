<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  authState,
  createUser,
  deleteUser,
  listUsers,
  updateUser
} from '../utils/authClient'

const users = ref([])
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const selectedResetUser = ref(null)
const resetPassword = ref('')

const createForm = reactive({
  username: '',
  displayName: '',
  password: '',
  role: 'user'
})

const userCount = computed(
  () => users.value.filter((user) => user.role === 'user').length
)
const adminCount = computed(
  () => users.value.filter((user) => user.role === 'admin').length
)

function clearMessages() {
  errorMessage.value = ''
  successMessage.value = ''
}

async function loadUsers() {
  loading.value = true
  clearMessages()
  try {
    users.value = await listUsers()
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

async function submitCreateUser() {
  loading.value = true
  clearMessages()
  try {
    const user = await createUser({ ...createForm })
    users.value = [...users.value, user].sort((a, b) =>
      a.username.localeCompare(b.username, 'zh-CN')
    )
    successMessage.value = `已创建账号 ${user.username}`
    Object.assign(createForm, {
      username: '',
      displayName: '',
      password: '',
      role: 'user'
    })
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

async function changeRole(user, role) {
  if (user.role === role) return
  loading.value = true
  clearMessages()
  try {
    const updated = await updateUser(user.id, { role })
    const index = users.value.findIndex((item) => item.id === user.id)
    if (index >= 0) users.value[index] = updated
    successMessage.value = `已更新 ${user.username} 的角色`
  } catch (error) {
    errorMessage.value = error.message
    await loadUsers()
  } finally {
    loading.value = false
  }
}

function openResetPassword(user) {
  clearMessages()
  selectedResetUser.value = user
  resetPassword.value = ''
}

async function submitResetPassword() {
  if (!selectedResetUser.value) return
  loading.value = true
  clearMessages()
  try {
    await updateUser(selectedResetUser.value.id, {
      password: resetPassword.value
    })
    successMessage.value = `已重置 ${selectedResetUser.value.username} 的密码`
    selectedResetUser.value = null
    resetPassword.value = ''
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

async function removeUser(user) {
  if (
    !window.confirm(
      `确定删除账号“${user.displayName}（${user.username}）”吗？此操作不可撤销。`
    )
  ) {
    return
  }

  loading.value = true
  clearMessages()
  try {
    await deleteUser(user.id)
    users.value = users.value.filter((item) => item.id !== user.id)
    successMessage.value = `已删除账号 ${user.username}`
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

function formatDate(value) {
  if (!value) return '尚未登录'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onMounted(loadUsers)
</script>

<template>
  <div class="admin-page">
    <header class="admin-header">
      <div>
        <span class="eyebrow">ACCESS & ACCOUNT ADMINISTRATION</span>
        <h1>用户与权限管理</h1>
        <p>管理员可创建普通用户、调整角色、重置密码或删除账号。</p>
      </div>
      <div class="account-summary">
        <div>
          <strong>{{ userCount }}</strong>
          <span>普通用户</span>
        </div>
        <div>
          <strong>{{ adminCount }}</strong>
          <span>管理员</span>
        </div>
        <div>
          <strong>{{ users.length }}</strong>
          <span>账号总数</span>
        </div>
      </div>
    </header>

    <p v-if="errorMessage" class="message error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-if="successMessage" class="message success" role="status">
      {{ successMessage }}
    </p>

    <main class="admin-grid">
      <section class="create-card">
        <header>
          <span>CREATE ACCOUNT</span>
          <h2>创建新账号</h2>
          <p>用户名用于登录，显示名称用于系统内识别。</p>
        </header>
        <form @submit.prevent="submitCreateUser">
          <label>
            <span>登录用户名</span>
            <input
              v-model.trim="createForm.username"
              minlength="3"
              maxlength="32"
              placeholder="例如 doctor01"
              required
            />
          </label>
          <label>
            <span>显示名称</span>
            <input
              v-model.trim="createForm.displayName"
              maxlength="40"
              placeholder="例如 张医生"
            />
          </label>
          <label>
            <span>初始密码</span>
            <input
              v-model="createForm.password"
              type="password"
              minlength="8"
              placeholder="至少 8 位"
              required
            />
          </label>
          <label>
            <span>账号角色</span>
            <select v-model="createForm.role">
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button type="submit" class="primary-button" :disabled="loading">
            创建账号
          </button>
        </form>
      </section>

      <section class="users-card">
        <header class="users-heading">
          <div>
            <span>ACCOUNT DIRECTORY</span>
            <h2>账号列表</h2>
          </div>
          <button class="refresh-button" type="button" @click="loadUsers">
            刷新
          </button>
        </header>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>角色</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id">
                <td>
                  <strong>{{ user.displayName }}</strong>
                  <small>{{ user.username }}</small>
                </td>
                <td>
                  <select
                    :value="user.role"
                    :disabled="user.id === authState.user?.id"
                    @change="changeRole(user, $event.target.value)"
                  >
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </td>
                <td>{{ formatDate(user.lastLoginAt) }}</td>
                <td class="row-actions">
                  <button type="button" @click="openResetPassword(user)">
                    重置密码
                  </button>
                  <button
                    type="button"
                    class="danger"
                    :disabled="user.id === authState.user?.id"
                    @click="removeUser(user)"
                  >
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <section v-if="selectedResetUser" class="reset-panel">
      <div>
        <span>RESET PASSWORD</span>
        <h2>重置 {{ selectedResetUser.displayName }} 的密码</h2>
        <p>账号：{{ selectedResetUser.username }}</p>
      </div>
      <form @submit.prevent="submitResetPassword">
        <input
          v-model="resetPassword"
          type="password"
          minlength="8"
          placeholder="输入至少 8 位新密码"
          required
        />
        <button type="submit" class="primary-button" :disabled="loading">
          确认重置
        </button>
        <button
          type="button"
          class="secondary-button"
          @click="selectedResetUser = null"
        >
          取消
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.admin-page {
  min-height: calc(100vh - 66px);
  padding: 24px clamp(18px, 3vw, 42px) 40px;
  color: #1b3042;
  background: #eef3f6;
}

.admin-header,
.admin-grid,
.message,
.reset-panel {
  width: min(1420px, 100%);
  margin-inline: auto;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  padding: 26px 30px;
  border-radius: 18px;
  color: #f2f8fb;
  background: linear-gradient(125deg, #11273b, #1b4a5b);
  box-shadow: 0 16px 38px rgba(26, 52, 72, 0.15);
}

.eyebrow,
.create-card header > span,
.users-heading span,
.reset-panel > div > span {
  color: #65dfc3;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.admin-header h1 {
  margin: 7px 0 7px;
  font-size: 36px;
  letter-spacing: -0.04em;
}

.admin-header p {
  margin: 0;
  color: #b6c9d5;
  font-size: 14px;
}

.account-summary {
  display: flex;
  gap: 8px;
}

.account-summary div {
  min-width: 104px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.055);
}

.account-summary strong,
.account-summary span {
  display: block;
}

.account-summary strong {
  color: #6ee1c5;
  font-size: 24px;
}

.account-summary span {
  margin-top: 2px;
  color: #9fb4c1;
  font-size: 11px;
}

.message {
  margin-top: 14px;
  padding: 12px 15px;
  border-radius: 9px;
  font-size: 13px;
}

.message.error {
  color: #963e47;
  border-left: 4px solid #cd5962;
  background: #fff2f3;
}

.message.success {
  color: #176b5a;
  border-left: 4px solid #36b394;
  background: #effaf7;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.62fr) minmax(0, 1.38fr);
  gap: 16px;
  margin-top: 16px;
}

.create-card,
.users-card {
  padding: 22px;
  border: 1px solid #d9e3e9;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10px 26px rgba(34, 58, 78, 0.07);
}

.create-card header > span,
.users-heading span {
  color: #347f70;
}

.create-card h2,
.users-heading h2,
.reset-panel h2 {
  margin: 6px 0 4px;
  font-size: 23px;
}

.create-card header p,
.reset-panel p {
  margin: 0;
  color: #728594;
  font-size: 12px;
}

.create-card form {
  display: grid;
  gap: 13px;
  margin-top: 20px;
}

.create-card label {
  display: grid;
  gap: 6px;
}

.create-card label span {
  color: #435d6f;
  font-size: 12px;
  font-weight: 800;
}

input,
select {
  width: 100%;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid #cdd8df;
  border-radius: 8px;
  outline: none;
  color: #1b3042;
  background: #fbfcfd;
  font: inherit;
  font-size: 14px;
}

input:focus,
select:focus {
  border-color: #4ab99f;
  box-shadow: 0 0 0 3px rgba(74, 185, 159, 0.12);
}

.primary-button,
.secondary-button,
.refresh-button,
.row-actions button {
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.primary-button {
  color: #062b23;
  background: #63ddc0;
}

.secondary-button,
.refresh-button {
  color: #3d5a6b;
  border: 1px solid #d3dfe5;
  background: #f5f8fa;
}

.users-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.table-wrap {
  margin-top: 18px;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 12px 10px;
  border-bottom: 1px solid #e6ecef;
  text-align: left;
  vertical-align: middle;
}

th {
  color: #647987;
  background: #f5f8fa;
  font-size: 11px;
  font-weight: 800;
}

td strong,
td small {
  display: block;
}

td small {
  margin-top: 3px;
  color: #8797a3;
  font-size: 11px;
}

td select {
  min-width: 108px;
  min-height: 34px;
  font-size: 12px;
}

.row-actions {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}

.row-actions button {
  min-height: 32px;
  padding: 0 9px;
  color: #426071;
  background: #eef3f5;
}

.row-actions button.danger {
  color: #9e4148;
  background: #fff0f1;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.reset-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 16px;
  padding: 20px 22px;
  border: 1px solid #d8e2e8;
  border-radius: 15px;
  background: #fff;
}

.reset-panel form {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 430px;
}

.reset-panel input {
  min-width: 220px;
}

@media (max-width: 1050px) {
  .admin-header,
  .reset-panel {
    align-items: flex-start;
    flex-direction: column;
  }

  .admin-grid {
    grid-template-columns: 1fr;
  }

  .reset-panel form {
    width: 100%;
    min-width: 0;
  }
}

@media (max-width: 680px) {
  .admin-page {
    padding: 14px;
  }

  .admin-header {
    padding: 21px;
  }

  .admin-header h1 {
    font-size: 30px;
  }

  .account-summary {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(3, 1fr);
  }

  .account-summary div {
    min-width: 0;
  }

  .reset-panel form {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
