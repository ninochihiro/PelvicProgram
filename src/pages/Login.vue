<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authState, login } from '../utils/authClient'

const route = useRoute()
const router = useRouter()
const role = ref('user')
const username = ref('')
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')

const roleTitle = computed(() =>
  role.value === 'admin' ? '管理员登录' : '用户登录'
)

function changeRole(nextRole) {
  role.value = nextRole
  password.value = ''
  errorMessage.value = ''
}

async function submitLogin() {
  errorMessage.value = ''

  try {
    await login({
      username: username.value,
      password: password.value,
      role: role.value
    })

    const redirect =
      typeof route.query.redirect === 'string' &&
      route.query.redirect !== '/login'
        ? route.query.redirect
        : '/'
    await router.replace(redirect)
  } catch (error) {
    errorMessage.value =
      error.message === 'Failed to fetch'
        ? '无法连接本地服务，请确认账号与串口服务已经启动。'
        : error.message
  }
}
</script>

<template>
  <main class="login-page">
    <section class="brand-panel">
      <div class="brand-mark">MPPS</div>
      <span class="eyebrow">PELVIC FLOOR CLINICAL TRAINING</span>
      <h1>盆底肌数字训练系统</h1>
      <p>
        面向盆底肌触诊学习、设备校准、训练和考核的本地化工作平台。
        系统按用户与管理员角色控制功能与设备访问权限。
      </p>
      <div class="system-features">
        <div>
          <strong>15</strong>
          <span>压力通道</span>
        </div>
        <div>
          <strong>17</strong>
          <span>考核目标</span>
        </div>
        <div>
          <strong>2</strong>
          <span>权限角色</span>
        </div>
      </div>
      <footer>MPPS LOCAL CLINICAL WORKSPACE</footer>
    </section>

    <section class="login-panel">
      <div class="login-card">
        <div class="login-heading">
          <span>SECURE ACCESS</span>
          <h2>{{ roleTitle }}</h2>
          <p>
            {{
              role === 'admin'
                ? '管理员可管理用户账号并访问设备诊断工具。'
                : '用户账号由管理员创建，可进入学习和训练模块。'
            }}
          </p>
        </div>

        <div class="role-switch" role="tablist" aria-label="登录角色">
          <button
            type="button"
            :class="{ active: role === 'user' }"
            :aria-selected="role === 'user'"
            role="tab"
            @click="changeRole('user')"
          >
            用户登录
          </button>
          <button
            type="button"
            :class="{ active: role === 'admin' }"
            :aria-selected="role === 'admin'"
            role="tab"
            @click="changeRole('admin')"
          >
            管理员登录
          </button>
        </div>

        <form @submit.prevent="submitLogin">
          <label>
            <span>用户名</span>
            <input
              v-model.trim="username"
              name="username"
              autocomplete="username"
              placeholder="请输入用户名"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <div class="password-field">
              <input
                v-model="password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="请输入密码"
                required
              />
              <button
                type="button"
                class="password-toggle"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </div>
          </label>

          <p v-if="errorMessage" class="login-error" role="alert">
            {{ errorMessage }}
          </p>

          <button
            class="login-submit"
            type="submit"
            :disabled="authState.loading"
          >
            {{ authState.loading ? '正在验证...' : `进入${roleTitle}` }}
          </button>
        </form>

        <p class="login-note">
          {{
            role === 'admin'
              ? '首次部署可使用默认管理员账号登录，并在用户管理中创建其他账号。'
              : '如当前没有用户账号，请先联系管理员创建。'
          }}
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr);
  min-height: 100vh;
  color: #182b3d;
  background: #eef2f5;
}

.brand-panel {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  justify-content: center;
  padding: clamp(42px, 7vw, 100px);
  color: #f1f7fb;
  background:
    linear-gradient(rgba(10, 28, 44, 0.92), rgba(16, 52, 66, 0.92)),
    repeating-linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.04) 0,
      rgba(255, 255, 255, 0.04) 1px,
      transparent 1px,
      transparent 18px
    );
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 76px;
  height: 54px;
  border-radius: 12px;
  color: #06261f;
  background: #67dfc1;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.eyebrow {
  margin-top: 30px;
  color: #70dfc4;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.brand-panel h1 {
  max-width: 760px;
  margin: 12px 0 18px;
  font-size: clamp(42px, 5vw, 68px);
  line-height: 1.12;
  letter-spacing: -0.045em;
}

.brand-panel > p {
  max-width: 720px;
  margin: 0;
  color: #b9cbd6;
  font-size: 16px;
  line-height: 1.9;
}

.system-features {
  display: flex;
  gap: 12px;
  margin-top: 38px;
}

.system-features div {
  min-width: 128px;
  padding: 14px 17px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
}

.system-features strong,
.system-features span {
  display: block;
}

.system-features strong {
  color: #72e1c4;
  font-size: 26px;
}

.system-features span {
  margin-top: 4px;
  color: #a8bdc9;
  font-size: 12px;
}

.brand-panel footer {
  margin-top: auto;
  padding-top: 48px;
  color: #6f8b9a;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.login-panel {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 30px;
  background: #eef2f5;
}

.login-card {
  width: min(460px, 100%);
  padding: 34px;
  border: 1px solid #d8e1e7;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 22px 55px rgba(31, 54, 72, 0.13);
}

.login-heading > span {
  color: #337f70;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.15em;
}

.login-heading h2 {
  margin: 8px 0 8px;
  font-size: 31px;
  letter-spacing: -0.035em;
}

.login-heading p {
  margin: 0;
  color: #657b8b;
  font-size: 14px;
  line-height: 1.7;
}

.role-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 25px 0 22px;
  padding: 5px;
  border-radius: 11px;
  background: #edf2f5;
}

.role-switch button {
  min-height: 42px;
  border: 0;
  border-radius: 8px;
  color: #607686;
  background: transparent;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.role-switch button.active {
  color: #073128;
  background: #6adfc2;
  box-shadow: 0 5px 14px rgba(45, 167, 137, 0.18);
}

form {
  display: grid;
  gap: 17px;
}

form label {
  display: grid;
  gap: 7px;
}

form label > span {
  color: #425b6d;
  font-size: 13px;
  font-weight: 800;
}

input {
  width: 100%;
  min-height: 48px;
  padding: 10px 13px;
  border: 1px solid #cdd9e1;
  border-radius: 9px;
  outline: none;
  color: #172c3f;
  background: #fbfcfd;
  font: inherit;
  font-size: 15px;
}

input:focus {
  border-color: #44b99e;
  box-shadow: 0 0 0 3px rgba(68, 185, 158, 0.12);
}

.password-field {
  position: relative;
}

.password-field input {
  padding-right: 70px;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 8px;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  color: #3c756a;
  background: #eef6f4;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  transform: translateY(-50%);
}

.login-error {
  margin: -4px 0 0;
  padding: 10px 12px;
  border-left: 3px solid #ce5b63;
  border-radius: 7px;
  color: #963f47;
  background: #fff3f4;
  font-size: 12px;
  line-height: 1.6;
}

.login-submit {
  min-height: 50px;
  border: 0;
  border-radius: 10px;
  color: #062b23;
  background: #61d9bd;
  font-size: 15px;
  font-weight: 900;
  cursor: pointer;
}

.login-submit:disabled {
  cursor: wait;
  opacity: 0.6;
}

.login-note {
  margin: 20px 0 0;
  padding-top: 18px;
  border-top: 1px solid #e4eaee;
  color: #7a8d9b;
  font-size: 11px;
  line-height: 1.7;
}

@media (max-width: 980px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .brand-panel,
  .login-panel {
    min-height: auto;
  }

  .brand-panel {
    padding: 40px 28px;
  }

  .brand-panel h1 {
    font-size: 42px;
  }

  .brand-panel footer {
    display: none;
  }
}

@media (max-width: 560px) {
  .brand-panel {
    padding: 30px 20px;
  }

  .brand-panel h1 {
    font-size: 36px;
  }

  .system-features {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .system-features div {
    min-width: 0;
    padding: 12px;
  }

  .login-panel {
    padding: 16px;
  }

  .login-card {
    padding: 24px 20px;
  }
}
</style>
