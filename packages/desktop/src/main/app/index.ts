import path from 'path'
import fsPromises from 'fs/promises'
import { exec } from 'child_process'
import dayjs from 'dayjs'
import log from 'electron-log'
import { app, BrowserWindow, clipboard, dialog, nativeTheme, shell, ipcMain } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { isChildOfDirectory } from 'common/filesystem/paths'
import type { IUserPreferences } from '@shared/types/preferences'
import { isLinux, isOsx, isWindows } from '../config'
import parseArgs from '../cli/parser'
import { normalizeAndResolvePath } from '../filesystem'
import { normalizeMarkdownPath } from '../filesystem/markdown'
import { registerKeyboardListeners } from '../keyboard'
import { selectTheme } from '../menu/actions/theme'
import { dockMenu } from '../menu/templates'
import registerSpellcheckerListeners from '../spellchecker'
import { watchers } from '../utils/imagePathAutoComplement'
import { onInternalChannel } from '../utils/internalIpc'
import { WindowType } from '../windows/base'
import EditorWindow from '../windows/editor'
import SettingWindow from '../windows/setting'
import { setLanguage } from '../i18n'
import { getNativeThemeSource, isDarkApplicationTheme } from './nativeTheme'
import type Accessor from './accessor'
import type WindowManager from './windowManager'

interface CliArgs {
  _: string[]
  [flag: string]: unknown
}

interface PathInfo {
  isDir: boolean
  path: string
}

class App {
  private _accessor: Accessor
  private _args: CliArgs
  private _openFilesCache: PathInfo[]
  private _openFilesTimer: ReturnType<typeof setTimeout> | null
  private _windowManager: WindowManager
  private _themeListenerRegistered: boolean

  /**
   * @param accessor 应用 accessor，提供各子系统实例
   * @param args 解析后的应用命令行参数
   */
  constructor(accessor: Accessor, args: Partial<CliArgs>) {
    this._accessor = accessor
    this._args = (args as CliArgs) || ({ _: [] } as CliArgs)
    this._openFilesCache = []
    this._openFilesTimer = null
    this._windowManager = this._accessor.windowManager
    // this.launchScreenshotWin = null // 发起截图的窗口
    // this.shortcutCapture = null

    // 初始化主进程语言
    this._initializeLanguage()
    this._listenForIpcMain()
    // 初始化主题监听
    this._themeListenerRegistered = false
  }

  /**
   * 应用入口
   */
  init(): void {
    // 启用实验性 Web 平台特性以使用 `backdrop-filter` CSS
    if (isOsx) {
      app.commandLine.appendSwitch('enable-experimental-web-platform-features', 'true')
    }

    app.on('second-instance', (_event, argv, workingDirectory) => {
      const { _openFilesCache, _windowManager } = this
      const args = parseArgs(argv.slice(1)) as CliArgs

      const buf: PathInfo[] = []
      for (const pathname of args._) {
        // 忽略未知 flag
        if (pathname.startsWith('--')) {
          continue
        }

        const info = normalizeMarkdownPath(path.resolve(workingDirectory, pathname))
        if (info) {
          buf.push(info as PathInfo)
        }
      }

      if (args['--new-window']) {
        this._openPathList(buf, true)
        return
      }

      _openFilesCache.push(...buf)
      if (_openFilesCache.length) {
        this._openFilesToOpen()
      } else {
        const activeWindow = _windowManager.getActiveWindow()
        if (activeWindow) {
          activeWindow.bringToFront()
        }
      }
    })

    app.on('open-file', this.openFile) // 仅 macOS

    app.on('ready', this.ready)

    app.on('window-all-closed', () => {
      // 关闭所有图片路径 watcher
      for (const watcher of watchers.values()) {
        watcher.close()
      }
      this._windowManager.closeWatcher()
      if (!isOsx) {
        app.quit()
      }
    })

    app.on('activate', () => {
      // 仅 macOS：点击 Dock 图标且无其他窗口时重建窗口
      if (this._windowManager.windowCount === 0) {
        this.ready()
      }
    })

    // 阻止 webview 加载及通过 HTML/JS 打开链接或新窗口
    app.on('web-contents-created', (_event, contents) => {
      contents.on('will-attach-webview', (event) => {
        event.preventDefault()
      })
      contents.on('will-navigate', (event) => {
        event.preventDefault()
      })
      contents.setWindowOpenHandler(() => {
        return { action: 'deny' }
      })
    })
  }

  /**
   * 从偏好设置初始化主进程语言
   */
  private async _initializeLanguage(): Promise<void> {
    try {
      let currentLanguage = this._accessor.preferences.getItem<string>('language')

      // 未设置语言时按系统语言自动检测
      if (!currentLanguage) {
        const systemLanguage = app.getLocale()
        log.info(`System language detected: ${systemLanguage}`)

        // 支持的语言列表（基于项目实际支持的语言）
        const supportedLanguages = [
          'en',
          'zh-CN',
          'zh-TW',
          'ja',
          'ko',
          'fr',
          'de',
          'es',
          'pt',
          'ru'
        ]

        // 系统语言代码 → 应用语言代码 映射
        const languageMap: Record<string, string> = {
          'zh-CN': 'zh-CN',
          'zh-TW': 'zh-TW',
          'zh-HK': 'zh-TW',
          zh: 'zh-CN',
          en: 'en',
          'en-US': 'en',
          'en-GB': 'en',
          ja: 'ja',
          'ja-JP': 'ja',
          ko: 'ko',
          'ko-KR': 'ko',
          fr: 'fr',
          'fr-FR': 'fr',
          de: 'de',
          'de-DE': 'de',
          es: 'es',
          'es-ES': 'es',
          pt: 'pt',
          'pt-BR': 'pt',
          ru: 'ru',
          'ru-RU': 'ru'
        }

        currentLanguage = languageMap[systemLanguage] || 'zh-CN'

        // 检测结果不在支持列表时使用简体中文
        if (!supportedLanguages.includes(currentLanguage)) {
          currentLanguage = 'zh-CN'
        }

        // 保存检测到的语言设置
        this._accessor.preferences.setItem('language', currentLanguage)
        log.info(`Auto-detected and set language to: ${currentLanguage}`)
      }

      setLanguage(currentLanguage)
      log.info(`Main process language initialized to: ${currentLanguage}`)
    } catch (error) {
      log.error('Failed to initialize main process language:', error)
      // 出错时默认使用简体中文
      setLanguage('zh-CN')
    }
  }

  async getScreenshotFileName(): Promise<string> {
    const screenshotFolderPath = (await this._accessor.dataCenter.getItem(
      'screenshotFolderPath'
    )) as string
    const fileName = `${dayjs().format('YYYY-MM-DD-HH-mm-ss')}-screenshot.png`
    return path.join(screenshotFolderPath, fileName)
  }

  ready = (): void => {
    const { _args: args, _openFilesCache } = this
    const { preferences, editorBufferStore } = this._accessor

    // 初始化语言设置
    const { startUpAction, defaultDirectoryToOpen, theme, language } = preferences.getAll()
    const followSystemTheme = preferences.getItem<boolean>('followSystemTheme')
    const lastOpenedFolder = preferences.getItem<string>('lastOpenedFolder')
    const lightModeTheme = preferences.getItem<string>('lightModeTheme')
    const darkModeTheme = preferences.getItem<string>('darkModeTheme')

    if (language) {
      setLanguage(language)
    }

    if (args._.length) {
      for (const pathname of args._) {
        // 忽略未知 flag
        if (pathname.startsWith('--')) {
          continue
        }

        const info = normalizeMarkdownPath(pathname)
        if (info) {
          _openFilesCache.push(info as PathInfo)
        }
      }
    }

    // 用户仅双击打开文件时不应恢复 buffer 或打开文件夹
    let isRestorePathway = false
    if (_openFilesCache.length === 0) {
      if (startUpAction === 'restoreAll') {
        // 基于上次 buffer 恢复
        isRestorePathway = true
      } else if (startUpAction === 'folder' && defaultDirectoryToOpen) {
        const info = normalizeMarkdownPath(defaultDirectoryToOpen)
        if (info) {
          _openFilesCache.unshift(info as PathInfo)
        }
      } else if (startUpAction === 'openLastFolder' && lastOpenedFolder) {
        const info = normalizeMarkdownPath(lastOpenedFolder)
        if (info) {
          _openFilesCache.unshift(info as PathInfo)
        }
      }
    }

    nativeTheme.themeSource = getNativeThemeSource({ followSystemTheme, theme })

    // 启用「跟随系统主题」时在启动应用主题
    const isDarkTheme = isDarkApplicationTheme(theme)
    const systemIsDark = nativeTheme.shouldUseDarkColors

    if (followSystemTheme && isDarkTheme !== systemIsDark) {
      const newTheme = systemIsDark ? darkModeTheme : lightModeTheme
      log.info(
        `Following system theme at startup: ${newTheme} (system ${systemIsDark ? 'dark' : 'light'})`
      )
      selectTheme(newTheme)
    }

    onInternalChannel(
      'broadcast-preferences-changed',
      (change: Partial<IUserPreferences>) => {
        const nextPreferences = {
          ...preferences.getAll(),
          ...change
        }
        nativeTheme.themeSource = getNativeThemeSource(nextPreferences)

      // 启用 followSystemTheme 时立即切换以匹配系统
        if (change.followSystemTheme === true) {
          const systemIsDark = nativeTheme.shouldUseDarkColors
          const lightModeTheme = preferences.getItem<string>('lightModeTheme')
          const darkModeTheme = preferences.getItem<string>('darkModeTheme')
          const newTheme = systemIsDark ? darkModeTheme : lightModeTheme

          log.info(
            `followSystemTheme enabled, switching to: ${newTheme} (system ${systemIsDark ? 'dark' : 'light'})`
          )
          selectTheme(newTheme)
          preferences.setItem('theme', newTheme)
        }
      // 浅色/深色主题偏好变更且跟随系统时立即应用
        if (
          preferences.getItem<boolean>('followSystemTheme') &&
        (change.lightModeTheme || change.darkModeTheme)
        ) {
          const systemIsDark = nativeTheme.shouldUseDarkColors

        // 取当前值，优先使用 change 事件中的新值
          let lightModeTheme = preferences.getItem<string>('lightModeTheme')
          let darkModeTheme = preferences.getItem<string>('darkModeTheme')

        // 若偏好刚被修改，使用 change 对象中的新值
          if (change.lightModeTheme !== undefined) {
            lightModeTheme = change.lightModeTheme
          }
          if (change.darkModeTheme !== undefined) {
            darkModeTheme = change.darkModeTheme
          }

          const newTheme = systemIsDark ? darkModeTheme : lightModeTheme

          log.info(`Theme preference changed, applying: ${newTheme}`)
          selectTheme(newTheme)
          preferences.setItem('theme', newTheme)
        }
      })

    // 监听系统主题变化并在启用时自动切换
    if (!this._themeListenerRegistered) {
      nativeTheme.on('updated', () => {
        const followSystemTheme = preferences.getItem<boolean>('followSystemTheme')
        const lightModeTheme = preferences.getItem<string>('lightModeTheme')
        const darkModeTheme = preferences.getItem<string>('darkModeTheme')

        if (followSystemTheme) {
          const systemIsDark = nativeTheme.shouldUseDarkColors
          const newTheme = systemIsDark ? darkModeTheme : lightModeTheme
          const currentTheme = preferences.getItem<string>('theme')

          // 仅在实际需要切换时更新主题
          if (newTheme !== currentTheme) {
            log.info(
              `System theme changed, switching to: ${newTheme} (system ${systemIsDark ? 'dark' : 'light'})`
            )
            selectTheme(newTheme)
            preferences.setItem('theme', newTheme)
          }
        }
      })
      this._themeListenerRegistered = true
    }

    if (isOsx) {
      app.dock?.setMenu(dockMenu)
    } else if (isWindows) {
      app.setJumpList([
        {
          type: 'recent'
        },
        {
          type: 'tasks',
          items: [
            {
              type: 'task',
              title: 'New Window',
              description: 'Opens a new window',
              program: process.execPath,
              args: '--new-window',
              iconPath: process.execPath,
              iconIndex: 0
            }
          ]
        }
      ])
    }

    const createWindow = (): void => {
      if (isRestorePathway) {
        // 按上次 buffer 恢复，每个 buffer store 文件对应一个窗口
        const bufferStores = editorBufferStore.getAll()
        const bufferStoreList = Object.values(bufferStores) as Array<{
          id: string
          filePath: string | null
        }>
        if (bufferStoreList.length === 0) {
          this._createEditorWindow()
          return
        }

        bufferStoreList.forEach((bufferStoreInfo) => {
          // 读取 buffer store 文件并传入内容
          this._createEditorWindow(null, [], [], {}, bufferStoreInfo)
        })
      } else if (_openFilesCache.length) {
        // 非恢复路径时应清空 buffer store，否则文件管理器双击打开会持续新建窗口
        editorBufferStore.clearBufferStoresWithAllSaved()
        this._openFilesToOpen()
      } else {
        this._createEditorWindow()
      }
    }

    if (isLinux) {
      let windowCreated = false

      const createWindowOnce = (): void => {
        if (windowCreated) return
        windowCreated = true
        createWindow()
      }

      // 等待主题稳定（Linux 特有问题？）
      nativeTheme.once('updated', createWindowOnce)
      // 若 'updated' 永不触发则超时兜底（无主题变化）
      setTimeout(createWindowOnce, 150)
    } else {
      // Windows/macOS 立即创建
      createWindow()
    }

    // this.shortcutCapture = new ShortcutCapture()
    // if (process.env.NODE_ENV === 'development') {
    //   this.shortcutCapture.dirname = path.resolve(path.join(__dirname, '../../../node_modules/shortcut-capture'))
    // }
    // this.shortcutCapture.on('capture', async ({ dataURL }) => {
    //   const { screenshotFileName } = this
    //   const image = nativeImage.createFromDataURL(dataURL)
    //   const bufferImage = image.toPNG()

    //   if (this.launchScreenshotWin) {
    //     this.launchScreenshotWin.webContents.send('mt::screenshot-captured')
    //     this.launchScreenshotWin = null
    //   }

    //   try {
    //     // write screenshot image into screenshot folder.
    //     await fse.writeFile(screenshotFileName, bufferImage)
    //   } catch (err) {
    //     log.error(err)
    //   }
    // })
  }

  openFile = (event: Electron.Event, pathname: string): void => {
    event.preventDefault()
    const info = normalizeMarkdownPath(pathname)
    if (info) {
      this._openFilesCache.push(info as PathInfo)

      if (app.isReady()) {
        // 可能还有更多文件待打开
        if (this._openFilesTimer) {
          clearTimeout(this._openFilesTimer)
        }
        this._openFilesTimer = setTimeout(() => {
          this._openFilesTimer = null
          this._openFilesToOpen()
        }, 100)
      }
    }
  }

  // --- 私有方法 ---

  /**
   * 创建新的编辑器窗口
   */
  private _createEditorWindow(
    rootDirectory: string | null = null,
    fileList: string[] = [],
    markdownList: string[] = [],
    options: Partial<BrowserWindowConstructorOptions> = {},
    bufferStoreInfo: { id: string; filePath: string | null } | null = null
  ): EditorWindow {
    const editor = new EditorWindow(this._accessor)
    if (rootDirectory) {
      this._accessor.preferences.setItems({ lastOpenedFolder: rootDirectory })
    }
    editor.createWindow(rootDirectory, fileList, markdownList, options, bufferStoreInfo)
    this._windowManager.add(editor)
    if (this._windowManager.windowCount === 1) {
      this._accessor.menu.setActiveWindow(editor.id!)
    }
    return editor
  }

  /**
   * 创建设置窗口
   */
  private _createSettingWindow(category?: string | null): void {
    const setting = new SettingWindow(this._accessor)
    setting.createWindow(category ?? null)
    this._windowManager.add(setting)
    if (this._windowManager.windowCount === 1) {
      this._accessor.menu.setActiveWindow(setting.id!)
    }
  }

  private _openFilesToOpen(): void {
    this._openPathList(this._openFilesCache, false)
  }

  /**
   * 在最合适的窗口中打开路径列表
   *
   * @param pathsToOpen 待打开的路径列表
   * @param openFilesInSameWindow 所有文件在同一窗口打开（取首个目录，丢弃其他目录）
   */
  private _openPathList(pathsToOpen: PathInfo[], openFilesInSameWindow: boolean = false): void {
    const { _windowManager } = this
    const openFilesInNewWindow = this._accessor.preferences.getItem<boolean>('openFilesInNewWindow')

    const fileSet = new Set<string>()
    const directorySet = new Set<string>()
    for (const { isDir, path } of pathsToOpen) {
      if (isDir) {
        directorySet.add(path)
      } else {
        fileSet.add(path)
      }
    }

    // 过滤已打开的目录
    for (const window of _windowManager.windows.values()) {
      if (window.type === WindowType.EDITOR) {
        const { openedRootDirectory } = window as EditorWindow
        if (openedRootDirectory && directorySet.has(openedRootDirectory)) {
          window.bringToFront()
          directorySet.delete(openedRootDirectory)
        }
      }
    }

    const directoriesToOpen: { rootDirectory: string | null; fileList: string[] }[] = Array.from(
      directorySet
    ).map((dir) => ({
      rootDirectory: dir,
      fileList: []
    }))
    const filesToOpen = Array.from(fileSet)

    // 同窗口模式：仅保留第一个目录并追加文件
    if (openFilesInSameWindow) {
      if (directoriesToOpen.length) {
        directoriesToOpen[0].fileList.push(...filesToOpen)
        directoriesToOpen.length = 1
      } else {
        directoriesToOpen.push({ rootDirectory: null, fileList: [...filesToOpen] })
      }
      filesToOpen.length = 0
    }

    // 为剩余文件寻找最合适的窗口
    if (!openFilesInSameWindow && !openFilesInNewWindow) {
      const isFirstWindow = _windowManager.getActiveEditorId() === null

      // 优先处理新目录
      for (let i = 0; i < directoriesToOpen.length; ++i) {
        const { fileList, rootDirectory } = directoriesToOpen[i]

        let breakOuterLoop = false
        for (let j = 0; j < filesToOpen.length; ++j) {
          const pathname = filesToOpen[j]
          if (isChildOfDirectory(rootDirectory ?? '', pathname)) {
            if (isFirstWindow) {
              fileList.push(...filesToOpen)
              filesToOpen.length = 0
              breakOuterLoop = true
              break
            }
            fileList.push(pathname)
            filesToOpen.splice(j, 1)
            --j
          }
        }

        if (breakOuterLoop) {
          break
        }
      }

      // 为剩余文件寻找最佳打开窗口
      if (isFirstWindow && directoriesToOpen.length && filesToOpen.length) {
        const { fileList } = directoriesToOpen[0]
        fileList.push(...filesToOpen)
        filesToOpen.length = 0
      } else {
        const windowList = _windowManager.findBestWindowToOpenIn(filesToOpen)
        for (const item of windowList) {
          const { windowId, fileList } = item

          // fileList 为空表示文件已全部打开
          if (fileList.length === 0) {
            continue
          }

          if (windowId !== null) {
            const window = _windowManager.get(windowId) as EditorWindow | undefined
            if (window) {
              window.openTabsFromPaths(fileList)
              window.bringToFront()
              continue
            }
            // else: fallthrough
          }
          this._createEditorWindow(null, fileList)
        }
      }

      // 目录若未打开则始终在新窗口打开
      for (const item of directoriesToOpen) {
        const { rootDirectory, fileList } = item
        this._createEditorWindow(rootDirectory, fileList)
      }
    } else {
      // 每个文件/目录各自在新窗口打开

      for (const pathname of filesToOpen) {
        this._createEditorWindow(null, [pathname])
      }

      for (const item of directoriesToOpen) {
        const { rootDirectory, fileList } = item
        this._createEditorWindow(rootDirectory, fileList)
      }
    }

    // 清空待打开列表
    pathsToOpen.length = 0
  }

  private _openSettingsWindow(category?: string | null): void {
    const settingWins = this._windowManager.getWindowsByType(WindowType.SETTINGS)
    if (settingWins.length >= 1) {
      // 设置窗口已存在
      const browserSettingWindow = settingWins[0].win.browserWindow!
      browserSettingWindow.webContents.send('settings::change-tab', category)
      if (isLinux) {
        browserSettingWindow.focus()
      } else {
        browserSettingWindow.moveTop()
      }
      return
    }
    this._createSettingWindow(category)
  }

  private _listenForIpcMain(): void {
    registerKeyboardListeners()
    registerSpellcheckerListeners()

    // 处理语言设置请求
    ipcMain.on('mt::get-current-language', (event) => {
      const { language } = this._accessor.preferences.getAll()
      event.reply('mt::current-language', language || 'zh-CN')
    })

    ipcMain.on('app-create-editor-window', () => {
      this._createEditorWindow()
    })

    onInternalChannel('screen-capture', async(win: BrowserWindow) => {
      if (isOsx) {
        // macOS 使用 `screencapture` 命令行
        const screenshotFileName = await this.getScreenshotFileName()
        exec('screencapture -i -c', async(err) => {
          if (err) {
            log.error(err)
            return
          }
          // renderer 已无法通过已移除的 `document.execCommand('paste')` 粘贴剪贴板位图，
          // 故将截图写入 PNG 并把路径交给 renderer 在光标处插入
          let savedPath = ''
          try {
            const image = clipboard.readImage()
            // 用户取消（Esc）时 `screencapture` 不写入剪贴板；跳过以免插入陈旧/空图像
            if (!image.isEmpty()) {
              const bufferImage = image.toPNG()
              await fsPromises.writeFile(screenshotFileName, bufferImage)
              savedPath = screenshotFileName
            }
          } catch (writeErr) {
            log.error(writeErr)
          }
          win.webContents.send('mt::screenshot-captured', savedPath)
        })
      } else {
        // TODO: 暂不处理，后续可能在 Linux/Windows 加入 screenCapture
        // if (this.shortcutCapture) {
        //   this.launchScreenshotWin = win
        //   this.shortcutCapture.shortcutCapture()
        // }
      }
    })

    onInternalChannel('app-create-settings-window', (category?: string) => {
      this._openSettingsWindow(category)
    })

    onInternalChannel('app-open-file-by-id', (windowId: number, filePath: string) => {
      const openFilesInNewWindow = this._accessor.preferences.getItem<boolean>('openFilesInNewWindow')
      if (openFilesInNewWindow) {
        this._createEditorWindow(null, [filePath])
      } else {
        const editor = this._windowManager.get(windowId) as EditorWindow | undefined
        if (editor) {
          editor.openTab(filePath, {}, true)
        }
      }
    })
    onInternalChannel('app-open-files-by-id', (windowId: number, fileList: string[]) => {
      const openFilesInNewWindow = this._accessor.preferences.getItem<boolean>('openFilesInNewWindow')
      if (openFilesInNewWindow) {
        this._createEditorWindow(null, fileList)
      } else {
        const editor = this._windowManager.get(windowId) as EditorWindow | undefined
        if (editor) {
          editor.openTabsFromPaths(
            fileList
              .map((p) => normalizeMarkdownPath(p))
              .filter((i): i is PathInfo => i !== null && !i.isDir)
              .map((i) => i.path)
          )
        }
      }
    })

    onInternalChannel('app-open-markdown-by-id', (windowId: number, data: string) => {
      const openFilesInNewWindow = this._accessor.preferences.getItem<boolean>('openFilesInNewWindow')
      if (openFilesInNewWindow) {
        this._createEditorWindow(null, [], [data])
      } else {
        const editor = this._windowManager.get(windowId) as EditorWindow | undefined
        if (editor) {
          editor.openUntitledTab(true, data)
        }
      }
    })

    onInternalChannel(
      'app-open-directory-by-id',
      (windowId: number, pathname: string, openInSameWindow: boolean) => {
        const { openFolderInNewWindow } = this._accessor.preferences.getAll()
        if (openInSameWindow || !openFolderInNewWindow) {
          const editor = this._windowManager.get(windowId) as EditorWindow | undefined
          if (editor) {
            editor.openFolder(pathname)
            return
          }
        }
        this._createEditorWindow(pathname)
      }
    )

    // --- renderer ---

    ipcMain.on('mt::app-try-quit', () => {
      app.quit()
    })

    ipcMain.on('mt::open-file-by-window-id', (_e, windowId: number, filePath: string) => {
      const resolvedPath = normalizeAndResolvePath(filePath)
      const openFilesInNewWindow = this._accessor.preferences.getItem<boolean>('openFilesInNewWindow')
      if (openFilesInNewWindow) {
        this._createEditorWindow(null, [resolvedPath])
      } else {
        const editor = this._windowManager.get(windowId) as EditorWindow | undefined
        if (editor) {
          editor.openTab(resolvedPath, {}, true)
        }
      }
    })

    ipcMain.on('mt::select-default-directory-to-open', async(e) => {
      const { preferences } = this._accessor
      const { defaultDirectoryToOpen } = preferences.getAll()
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return

      const { filePaths } = await dialog.showOpenDialog(win, {
        defaultPath: defaultDirectoryToOpen,
        properties: ['openDirectory', 'createDirectory']
      })
      if (filePaths && filePaths[0]) {
        preferences.setItems({ defaultDirectoryToOpen: filePaths[0] })
      }
    })

    ipcMain.on('mt::open-setting-window', () => {
      this._openSettingsWindow()
    })

    ipcMain.on('mt::make-screenshot', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      ipcMain.emit('screen-capture', win)
    })

    ipcMain.on('mt::request-keybindings', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      const { keybindings } = this._accessor
      // Map 转 object
      win.webContents.send('mt::keybindings-response', Object.fromEntries(keybindings.keys))
    })

    ipcMain.on('mt::open-keybindings-config', () => {
      const { keybindings } = this._accessor
      keybindings.openConfigInFileManager()
    })

    ipcMain.handle('mt::keybinding-get-pref-keybindings', () => {
      const { keybindings } = this._accessor
      const defaultKeybindings = keybindings.getDefaultKeybindings()
      const userKeybindings = keybindings.getUserKeybindings()
      return { defaultKeybindings, userKeybindings }
    })

    ipcMain.handle('mt::keybinding-save-user-keybindings', async(_event, userKeybindings) => {
      const { keybindings } = this._accessor
      return keybindings.setUserKeybindings(userKeybindings)
    })

    ipcMain.handle('mt::fs-trash-item', async(_event, fullPath: string) => {
      return shell.trashItem(fullPath)
    })
  }
}

export default App
