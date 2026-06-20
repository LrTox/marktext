/** 主进程 i18n：当前语言与窗口 language-changed 广播。 */
import { getTranslation } from 'common/i18n'
import { BrowserWindow } from 'electron'

// 当前语言（可从配置文件或用户设置获取）
let currentLanguage = 'zh-CN'

/**
 * 获取翻译文本。
 */
export function t(key: string, params: Record<string, string | number> = {}): string {
  return getTranslation(key, currentLanguage, params)
}

/**
 * 获取当前语言。
 */
export function getCurrentLanguage(): string {
  return currentLanguage
}

/**
 * 设置语言并通知所有窗口。
 */
export function setLanguage(language: string): void {
  currentLanguage = language

  const windows = BrowserWindow.getAllWindows()
  windows.forEach((window) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('language-changed', language)
    }
  })
}
