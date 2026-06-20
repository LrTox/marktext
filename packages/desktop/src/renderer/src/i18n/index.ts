import { createI18n } from 'vue-i18n'
import bus from '../bus'

// 直接导入翻译文件
import zhCNTranslations from '../../../../static/locales/zh-CN.json'
import enTranslations from '../../../../static/locales/en.json'

// 创建 Vue i18n 实例。
// vue-i18n 在 Composition + Legacy 模式下的 options 类型交集难以用混合形态满足；
// 在调用处一次性 cast，避免进一步扩散 `any`。
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCNTranslations, en: enTranslations },
  // 禁用 linking，避免 '@' 被误解析
  modifiers: {
    '@': () => '@'
  },
  // 禁用复数解析
  pluralRules: {},
  // 自定义 message compiler，处理含 '|' 的字符串
  messageCompiler: {
    compile: (message: unknown) => {
      // 含 '|' 时返回原始字符串，不做复数解析
      if (typeof message === 'string' && message.includes('|')) {
        return () => message
      }
      // 其他消息使用默认 compiler
      return null
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

// 导出翻译函数 —— 正确处理 Vue i18n v9+ 的 global getter
export const t = (key: string, ...args: unknown[]): string => {
  // 检查 i18n 实例是否可用
  if (!i18n) {
    console.warn('⚠️ i18n实例不可用，使用英文fallback')
    return key
  }

  try {
    // 正确访问 global 属性
    if (!i18n.global) {
      console.warn('⚠️ i18n.global not ready yet, falling back to EN')
      return key
    }

    // vue-i18n 的 `t` 重载较多；此处有意绕过严格 overload 集
    return (i18n.global.t as (key: string, ...args: unknown[]) => string)(key, ...args)
  } catch (error) {
    console.error('❌ 翻译函数执行错误:', error)
    return key
  }
}

// 缓存进行中的翻译加载，避免并发 setLanguage() 对同一 locale 重复 IPC
const inflightLoads = new Map<string, Promise<Record<string, unknown> | undefined>>()

// 导出语言切换函数
export const setLanguage = async(locale: string): Promise<void> => {
  if (!locale) return
  const globalI18n = i18n.global
  if (!globalI18n.availableLocales.includes(locale)) {
    let pending = inflightLoads.get(locale)
    if (!pending) {
      pending = Promise.resolve(window.i18nUtils.loadTranslations(locale)).finally(() =>
        inflightLoads.delete(locale)
      )
      inflightLoads.set(locale, pending)
    }
    const translation = await pending
    if (!translation) return // locale 文件加载失败

    if (!globalI18n.availableLocales.includes(locale)) {
      globalI18n.setLocaleMessage(locale, translation)
      console.log(`🌐 Loaded and set new locale: ${locale}`)
    }
  }
  globalI18n.locale.value = locale
}

// 导出当前语言 getter
export const getCurrentLanguage = (): string => {
  return i18n.global.locale.value
}

// 导出 i18n 实例（命名与默认导出）
export { i18n }
export default i18n

// 监听语言变更
if (window.electron && window.electron.ipcRenderer) {
  window.electron.ipcRenderer.on('language-changed', (_event, newLocale) => {
    setLanguage(newLocale)
    bus.emit('language-changed', newLocale)
  })

  // 启动时请求当前语言设置
  window.electron.ipcRenderer.send('mt::get-current-language')
  window.electron.ipcRenderer.on('mt::current-language', (_event, language) => {
    setLanguage(language)
    bus.emit('language-changed', language)
  })
}
