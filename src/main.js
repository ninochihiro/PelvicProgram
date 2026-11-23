import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { restoreSession } from './utils/authClient'

async function bootstrap() {
  await restoreSession()
  const app = createApp(App)
  app.use(router)
  app.mount('#app')
}

bootstrap()
