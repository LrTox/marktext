import fs from 'fs'
import path from 'path'
import Store, { type Schema } from 'electron-store'
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import log from 'electron-log'
import { isWindows } from '../config'
import { hasSameKeys } from '../utils'
import { onInternalChannel } from '../utils/internalIpc'
import { getSupportedLanguages, isLanguageSupported } from 'common/i18n'
import { TypedEmitter } from '@shared/types/typedEmitter'
import type { IUserPreferences } from '@shared/types/preferences'
import schema from './schema.json'

const PREFERENCES_FILE_NAME = 'preferences'

// Preference 继承 TypedEmitter 但自身暂不 emit 事件 —— 待具体事件定义后再扩展 event map
type PreferenceEvents = Record<string, unknown[]>

// EnvPaths/AppPaths 的结构性子集 —— 此处仅读取 `preferencesPath`
interface AppPaths {
  readonly preferencesPath: string
}

class Preference extends TypedEmitter<PreferenceEvents> {
  public readonly preferencesPath: string
  public readonly hasPreferencesFile: boolean
  public readonly store: Store<IUserPreferences>
  public readonly staticPath: string

  /**
   * @param paths 路径实例
   *
   * 注意：校验失败时会抛出异常
   */
  constructor(paths: AppPaths) {
    // TODO: 若 global.MARKTEXT_SAFE_MODE 已设置，则不应加载 Preferences
    super()

    const { preferencesPath } = paths
    this.preferencesPath = preferencesPath
    this.hasPreferencesFile = fs.existsSync(
      path.join(this.preferencesPath, `./${PREFERENCES_FILE_NAME}.json`)
    )
    this.store = new Store<IUserPreferences>({
      schema: schema as unknown as Schema<IUserPreferences>,
      name: PREFERENCES_FILE_NAME,
      migrations: {
        '0.18.6': (store) => {
          if (store.get('startUpAction') === 'lastState') {
            store.set('startUpAction', 'openLastFolder')
          }
        }
      },
      beforeEachMigration: (_store, context) => {
        log.info(`Preferences migration: ${context.fromVersion} -> ${context.toVersion}`)
      }
    })

    this.staticPath = path.join(global.__static, 'preference.json')
    this.init()
  }

  init = (): void => {
    let defaultSettings: Record<string, unknown> | null = null
    try {
      defaultSettings = JSON.parse(fs.readFileSync(this.staticPath, { encoding: 'utf8' }) || '{}')

      // 首次启动时根据系统主题选择最佳主题
      if (nativeTheme.shouldUseDarkColors) {
        defaultSettings!.theme = 'dark'
      }
    } catch (err) {
      log.error(err)
    }

    if (!defaultSettings) {
      throw new Error('Can not load static preference.json file')
    }

    // 首次加载时 `this.store.size` 为 3 的原因不明，故改为检查文件是否存在
    if (!this.hasPreferencesFile) {
      this.store.set(defaultSettings)
    } else {
      // `this.getAll()` 返回 plainObject，无法使用 `hasOwnProperty`
      // const plainObject = () => Object.create(null)
      const userSetting = this.getAll() as Record<string, unknown>
      // 合并过时的设置项
      const requiresUpdate = !hasSameKeys(defaultSettings, userSetting)
      const userSettingKeys = Object.keys(userSetting)
      const defaultSettingKeys = Object.keys(defaultSettings)

      if (requiresUpdate) {
        // TODO(fxha): 性能原因应考虑替换 electron-store ——
        //   修改条目时会多次阻塞 I/O，且无事务或 async I/O。
        //   改用它的核心原因是 JSON schema 校验。

        // 移除过时设置项
        for (const key of userSettingKeys) {
          if (!defaultSettingKeys.includes(key)) {
            delete userSetting[key]
            this.store.delete(key)
          }
        }

        // 添加新设置项
        let addedNewEntries = false
        for (const key in defaultSettings) {
          if (!userSettingKeys.includes(key)) {
            addedNewEntries = true
            userSetting[key] = defaultSettings[key]
          }
        }
        if (addedNewEntries) {
          this.store.set(userSetting)
        }
      }
    }

    this._listenForIpcMain()
  }

  getAll(): IUserPreferences {
    return this.store.store as IUserPreferences
  }

  setItem(key: string, value: unknown): void {
    this.store.set(key, value)
    ipcMain.emit('broadcast-preferences-changed', { [key]: value })
  }

  getItem<T = unknown>(key: string): T {
    return this.store.get(key) as T
  }

  /**
   * 批量修改设置项
   *
   * @param settings 含 key/value 的设置对象或子集
   */
  setItems(settings: Record<string, unknown> | null | undefined): void {
    if (!settings) {
      log.error('Cannot change settings without entires: object is undefined or null.')
      return
    }

    Object.keys(settings).forEach((key) => {
      this.setItem(key, settings[key])
    })
  }

  getPreferredEol(): 'lf' | 'crlf' {
    const endOfLine = this.getItem<string>('endOfLine')
    if (endOfLine === 'lf') {
      return 'lf'
    }
    return endOfLine === 'crlf' || isWindows ? 'crlf' : 'lf'
  }

  exportJSON(): void {
    // todo
  }

  importJSON(): void {
    // todo
  }

  _listenForIpcMain(): void {
    ipcMain.on('mt::ask-for-user-preference', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win) {
        win.webContents.send('mt::user-preference', this.getAll())
      }
    })
    ipcMain.on('mt::set-user-preference', (_e, settings: Record<string, unknown>) => {
      this.setItems(settings)
    })
    ipcMain.on('mt::cmd-toggle-autosave', () => {
      this.setItem('autoSave', !this.getItem('autoSave'))
    })

    onInternalChannel('set-user-preference', (settings: Record<string, unknown>) => {
      this.setItems(settings)
    })
  }

  /**
   * 获取系统语言；若不在支持列表中则返回 null
   * @returns 支持的系统语言代码或 null
   */
  _getSystemLanguage(): string | null {
    try {
      // 获取系统语言
      const systemLocale = app.getLocale()
      log.info(`System locale detected: ${systemLocale}`)

      // 获取支持的语言列表
      const supportedLanguages = getSupportedLanguages()

      // 直接匹配完整语言代码（如 zh-CN）
      if (isLanguageSupported(systemLocale)) {
        log.info(`Using system language: ${systemLocale}`)
        return systemLocale
      }

      // 尝试匹配主语言部分（如 zh）
      const primaryLanguage = systemLocale.split('-')[0]!
      const matchedLanguage = supportedLanguages.find((lang) => lang.startsWith(primaryLanguage))

      if (matchedLanguage) {
        log.info(`Using matched language: ${matchedLanguage} for system locale: ${systemLocale}`)
        return matchedLanguage
      }

      log.info(`System language ${systemLocale} not supported, will use default language`)
      return null
    } catch (error) {
      log.error('Error detecting system language:', error)
      return null
    }
  }
}

export default Preference
