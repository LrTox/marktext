import { createApp, type App } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import bootstrapRenderer from './bootstrap'
import axios from './axios'
import pinia from './store'
import './assets/symbolIcon'

// Vue 3 使用 Element Plus 替代 Element UI
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// i18n 翻译系统
import i18nPlugin from './i18n'

// 此处可能有问题！ \/
import services from './services/index'
import routes from './router'
import Main from './Main.vue'

import './assets/styles/index.css'
import './assets/styles/electronAppRegion.css'
import './assets/styles/printService.css'

// -----------------------------------------------

window.marktext = {}
bootstrapRenderer()

// -----------------------------------------------
// 修改此行之前的代码请谨慎！

// 创建 Vue 应用
const app: App<Element> = createApp(Main)

// 配置 Element Plus 语言包
app.use(ElementPlus, {
  locale: zhCn
})

const envType = window.marktext?.env?.type as string | undefined

const router = createRouter({
  history: createWebHashHistory(),
  // vue-router 行为似乎有变：使用 createWebHistory() 时会用完整「文件路径」
  // 而非 /editor 这类链接
  routes: routes(envType)
})

app.use(router)
app.use(pinia)
app.use(i18nPlugin)

// 全局配置 axios
app.config.globalProperties.$http = axios

// 全局注册 services
;(services as unknown as Array<Record<string, unknown> & { name: string }>).forEach((s) => {
  app.config.globalProperties['$' + s.name] = s[s.name]
})

// 挂载应用
app.mount('#app')
