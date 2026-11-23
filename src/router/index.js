import { createRouter, createWebHistory } from 'vue-router'
import Home from '../pages/Home.vue'
import { authState, restoreSession } from '../utils/authClient'

const routes = [
  {
    path: '/login',
    component: () => import('../pages/Login.vue'),
    meta: { public: true, hideNav: true }
  },
  {
    path: '/',
    component: Home
  },
  {
    path: '/begin',
    component: () => import('../pages/Begin.vue')
  },
  {
    path: '/theory',
    component: () => import('../pages/Theory.vue')
  },
  {
    path: '/test',
    component: () => import('../pages/Test.vue'),
    meta: { adminOnly: true }
  },
  {
    path: '/regular',
    redirect: { path: '/training', query: { mode: 'learning' } }
  },
  {
    path: '/regularr',
    redirect: { path: '/training', query: { mode: 'learning' } }
  },
  {
    path: '/intensive',
    redirect: { path: '/training', query: { mode: 'intensive' } }
  },
  {
    path: '/score',
    redirect: { path: '/training', query: { mode: 'exam' } }
  },
  {
    path: '/sensor',
    component: () => import('../pages/SensorMap.vue')
  },
  {
    path: '/training',
    component: () => import('../pages/TrainingCenter.vue')
  },
  {
    path: '/admin',
    component: () => import('../pages/AdminUsers.vue'),
    meta: { adminOnly: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router

router.beforeEach(async (to) => {
  await restoreSession()

  if (to.meta.public) {
    if (authState.user) return '/'
    return true
  }

  if (!authState.user) {
    return {
      path: '/login',
      query: { redirect: to.fullPath }
    }
  }

  if (to.meta.adminOnly && authState.user.role !== 'admin') {
    return '/'
  }

  return true
})
