<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authState, logout } from '../utils/authClient'

const route = useRoute()
const router = useRouter()

const trainingLinks = [
  { mode: 'learning', label: '基础学习' },
  { mode: 'intensive', label: '准确性' },
  { mode: 'comprehensive', label: '全面性' },
  { mode: 'exam', label: '模拟考场' }
]

const currentTrainingMode = computed(() =>
  route.path === '/training' ? String(route.query.mode ?? 'learning') : ''
)

const userInitial = computed(
  () =>
    String(authState.user?.displayName ?? authState.user?.username ?? '用').slice(
      0,
      1
    )
)

async function handleLogout() {
  await logout()
  await router.replace('/login')
}
</script>

<template>
  <header class="system-nav">
    <RouterLink to="/" class="brand">
      <span class="brand-mark">MPPS</span>
      <span class="brand-copy">
        <strong>盆底肌数字训练系统</strong>
        <small>Pelvic floor assessment & training</small>
      </span>
    </RouterLink>

    <nav aria-label="系统主要功能">
      <RouterLink
        to="/"
        class="nav-link"
        :class="{ active: route.path === '/' }"
      >
        系统概览
      </RouterLink>
      <RouterLink
        to="/theory"
        class="nav-link"
        :class="{ active: route.path === '/theory' }"
      >
        理论模型
      </RouterLink>
      <RouterLink
        v-for="item in trainingLinks"
        :key="item.mode"
        :to="{ path: '/training', query: { mode: item.mode } }"
        class="nav-link"
        :class="{ active: currentTrainingMode === item.mode }"
      >
        {{ item.label }}
      </RouterLink>
      <RouterLink
        to="/sensor"
        class="nav-link"
        :class="{ active: route.path === '/sensor' || route.path === '/test' }"
      >
        传感工具
      </RouterLink>
      <RouterLink
        to="/begin"
        class="nav-link"
        :class="{ active: route.path === '/begin' }"
      >
        使用说明
      </RouterLink>
      <RouterLink
        v-if="authState.user?.role === 'admin'"
        to="/admin"
        class="nav-link"
        :class="{ active: route.path === '/admin' }"
      >
        用户管理
      </RouterLink>
    </nav>

    <div class="account-area">
      <span class="user-avatar">{{ userInitial }}</span>
      <div class="user-copy">
        <strong>{{ authState.user?.displayName }}</strong>
        <small>
          {{ authState.user?.role === 'admin' ? '管理员' : '普通用户' }}
        </small>
      </div>
      <button type="button" @click="handleLogout">退出</button>
    </div>
  </header>
</template>

<style scoped>
.system-nav {
  position: sticky;
  top: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 28px;
  min-height: 66px;
  padding: 0 28px;
  color: #eaf6fb;
  background: rgba(12, 29, 46, 0.97);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 26px rgba(15, 35, 55, 0.16);
  backdrop-filter: blur(14px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 38px;
  border-radius: 11px;
  color: #06251f;
  background: linear-gradient(135deg, #5ee5c3, #8bdffc);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.brand-copy {
  display: grid;
  gap: 1px;
}

.brand-copy strong {
  font-size: 14px;
}

.brand-copy small {
  color: #8fa8bb;
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

nav {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

nav::-webkit-scrollbar {
  display: none;
}

.nav-link {
  flex: none;
  padding: 8px 11px;
  border-radius: 9px;
  color: #a9bdcc;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  transition: color 0.18s ease, background 0.18s ease;
}

.nav-link:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.07);
}

.nav-link.active {
  color: #07261f;
  background: #5de1bf;
}

.account-area {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  white-space: nowrap;
}

.user-avatar {
  display: grid;
  place-items: center;
  width: 31px;
  height: 31px;
  border-radius: 50%;
  color: #06291f;
  background: #62dfc1;
  font-size: 13px;
  font-weight: 900;
}

.user-copy {
  display: grid;
  gap: 1px;
}

.user-copy strong {
  max-width: 100px;
  overflow: hidden;
  color: #e5f0f5;
  font-size: 11px;
  text-overflow: ellipsis;
}

.user-copy small {
  color: #829daf;
  font-size: 9px;
}

.account-area button {
  min-height: 29px;
  padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  color: #b4c6d2;
  background: rgba(255, 255, 255, 0.055);
  font-size: 10px;
  cursor: pointer;
}

.account-area button:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

@media (max-width: 1100px) {
  .system-nav {
    gap: 16px;
    padding: 0 16px;
  }

  .brand-copy {
    display: none;
  }

  .user-copy {
    display: none;
  }
}

@media (max-width: 680px) {
  .system-nav {
    min-height: 58px;
  }

  .brand-mark {
    width: 43px;
    height: 34px;
  }

  .nav-link {
    padding: 7px 9px;
    font-size: 11px;
  }

  .user-avatar {
    width: 28px;
    height: 28px;
  }

  .account-area button {
    padding: 0 7px;
    font-size: 9px;
  }
}
</style>
