import { defineStore } from 'pinia'
import bus from '../bus'
import { setLanguage } from '@/i18n'

// 有限值联合类型 —— 运行时约束字段取值，其余处以 plain string 保留，
// 避免对从磁盘读取原始值的消费者过早收窄类型。
export type EndOfLine = 'default' | 'lf' | 'crlf'
export type TitleBarStyle = 'custom' | 'native'
export type StartUpAction = 'restoreAll' | 'lastSession' | 'blank'
export type TextDirection = 'ltr' | 'rtl'
export type BulletListMarker = '*' | '+' | '-'
export type OrderListDelimiter = '.' | ')'
export type PreferHeadingStyle = 'atx' | 'setext'
export type FrontmatterType = '-' | ';' | '{' | '+'
export type SequenceTheme = 'hand' | 'simple'
export type ImageInsertAction = 'folder' | 'path' | 'upload'
export type ImageRelativeDirectoryBase = 'file' | 'root'
export type FileSortBy = 'created' | 'modified' | 'title'
export type FileSortOrder = 'asc' | 'desc'

export interface PreferencesState {
  // ----- 通用 -----
  autoSave: boolean
  autoSaveDelay: number
  titleBarStyle: TitleBarStyle | string
  openFilesInNewWindow: boolean
  openFolderInNewWindow: boolean
  zoom: number
  hideScrollbar: boolean
  wordWrapInToc: boolean
  fileSortBy: FileSortBy | string
  fileSortOrder: FileSortOrder | string
  startUpAction: StartUpAction | string
  restoreLayoutState: boolean
  defaultDirectoryToOpen: string
  lastOpenedFolder: string
  treePathExcludePatterns: string[]
  language: string

  // ----- 编辑器 / 排版 -----
  editorFontFamily: string
  fontSize: number
  lineHeight: number
  codeFontSize: number
  codeFontFamily: string
  codeBlockLineNumbers: boolean
  trimUnnecessaryCodeBlockEmptyLines: boolean
  wrapCodeBlocks: boolean
  editorLineWidth: string

  // ----- Markdown 编辑 -----
  autoPairBracket: boolean
  autoPairMarkdownSyntax: boolean
  autoPairQuote: boolean
  endOfLine: EndOfLine | string
  defaultEncoding: string
  autoGuessEncoding: boolean
  autoNormalizeLineEndings: boolean

  trimTrailingNewline: number
  textDirection: TextDirection | string
  hideQuickInsertHint: boolean
  imageInsertAction: ImageInsertAction | string
  imagePreferRelativeDirectory: boolean
  imageRelativeDirectoryBase: ImageRelativeDirectoryBase | string
  imageRelativeDirectoryName: string
  hideLinkPopup: boolean
  autoCheck: boolean

  preferLooseListItem: boolean
  bulletListMarker: BulletListMarker | string
  orderListDelimiter: OrderListDelimiter | string
  preferHeadingStyle: PreferHeadingStyle | string
  tabSize: number
  listIndentation: number
  frontmatterType: FrontmatterType | string
  superSubScript: boolean
  footnote: boolean
  isHtmlEnabled: boolean
  isGitlabCompatibilityEnabled: boolean
  sequenceTheme: SequenceTheme | string
  plantumlServer: string

  // ----- 主题 -----
  theme: string
  followSystemTheme: boolean
  lightModeTheme: string
  darkModeTheme: string
  customCss: string

  // ----- 拼写检查 -----
  spellcheckerEnabled: boolean
  spellcheckerNoUnderline: boolean
  spellcheckerLanguage: string

  // ----- 侧边栏 / 标签栏可见性（持久化） -----
  sideBarVisibility: boolean
  tabBarVisibility: boolean
  sourceCodeModeEnabled: boolean
  openedFilesInSidebar: boolean

  // ----- 搜索 -----
  searchExclusions: string[]
  searchMaxFileSize: string
  searchIncludeHidden: boolean
  searchNoIgnore: boolean
  searchFollowSymlinks: boolean

  watcherUsePolling: boolean

  // ----- 编辑模式（每窗口，不持久化） -----
  typewriter: boolean
  focus: boolean
  sourceCode: boolean

  // ----- 用户配置 -----
  imageFolderPath: string
  webImages: unknown[]
  cloudImages: unknown[]
  currentUploader: string
  cliScript: string
}

interface SingleSetPreferencePayload {
  type: keyof PreferencesState | string
  value: unknown
}

interface SetUserDataPayload {
  type: string
  value: unknown
}

interface ModeTogglePayload {
  type: keyof PreferencesState | 'typewriter' | 'focus' | 'sourceCode'
  checked: boolean
}

export const usePreferencesStore = defineStore('preferences', {
  state: (): PreferencesState => ({
    autoSave: false,
    autoSaveDelay: 5000,
    titleBarStyle: 'custom',
    openFilesInNewWindow: false,
    openFolderInNewWindow: false,
    zoom: 1.0,
    hideScrollbar: false,
    wordWrapInToc: false,
    fileSortBy: 'created',
    fileSortOrder: 'asc',
    startUpAction: 'restoreAll',
    restoreLayoutState: true,
    defaultDirectoryToOpen: '',
    lastOpenedFolder: '',
    treePathExcludePatterns: [],
    language: 'zh-CN',

    editorFontFamily: 'Open Sans',
    fontSize: 16,
    lineHeight: 1.6,
    codeFontSize: 14,
    codeFontFamily: 'DejaVu Sans Mono',
    codeBlockLineNumbers: false,
    trimUnnecessaryCodeBlockEmptyLines: true,
    wrapCodeBlocks: false,
    editorLineWidth: '',

    autoPairBracket: true,
    autoPairMarkdownSyntax: true,
    autoPairQuote: true,
    endOfLine: 'default',
    defaultEncoding: 'utf8',
    autoGuessEncoding: true,
    autoNormalizeLineEndings: false,

    trimTrailingNewline: 2,
    textDirection: 'ltr',
    hideQuickInsertHint: false,
    imageInsertAction: 'folder',
    imagePreferRelativeDirectory: false,
    imageRelativeDirectoryBase: 'file',
    imageRelativeDirectoryName: 'assets',
    hideLinkPopup: false,
    autoCheck: false,

    preferLooseListItem: true,
    bulletListMarker: '-',
    orderListDelimiter: '.',
    preferHeadingStyle: 'atx',
    tabSize: 4,
    listIndentation: 1,
    frontmatterType: '-',
    superSubScript: false,
    footnote: false,
    isHtmlEnabled: true,
    isGitlabCompatibilityEnabled: false,
    sequenceTheme: 'hand',
    plantumlServer: 'https://www.plantuml.com/plantuml',

    theme: 'light',
    followSystemTheme: true,
    lightModeTheme: 'light',
    darkModeTheme: 'dark',
    customCss: '',

    spellcheckerEnabled: false,
    spellcheckerNoUnderline: false,
    spellcheckerLanguage: 'en-US',

    // 以下默认值会被启动时覆盖
    sideBarVisibility: false,
    tabBarVisibility: false,
    sourceCodeModeEnabled: false,
    openedFilesInSidebar: true,

    searchExclusions: [],
    searchMaxFileSize: '',
    searchIncludeHidden: false,
    searchNoIgnore: false,
    searchFollowSymlinks: true,

    watcherUsePolling: false,

    // --------------------------------------------------------------------------

    // 当前窗口的编辑模式（不属于持久化设置）
    typewriter: false, // 打字机模式
    focus: false, // 焦点模式
    sourceCode: false, // 源码模式

    // 用户配置
    imageFolderPath: '',
    webImages: [],
    cloudImages: [],
    currentUploader: 'picgo',
    cliScript: ''
  }),

  getters: {
    getAll: (state): PreferencesState => state
  },

  actions: {
    SET_USER_PREFERENCE(preference: Partial<PreferencesState> | Record<string, unknown>): void {
      const oldLanguage = this.language

      Object.keys(preference).forEach((key) => {
        const incoming = (preference as Record<string, unknown>)[key]
        if (
          typeof incoming !== 'undefined' &&
          typeof (this as unknown as Record<string, unknown>)[key] !== 'undefined'
        ) {
          ;(this as unknown as Record<string, unknown>)[key] = incoming
        }
      })

      // 语言偏好变更时更新 i18n
      const lang = (preference as { language?: string }).language
      if (lang && lang !== oldLanguage) {
        setLanguage(lang)
      }
    },

    SET_MODE({ type, checked }: ModeTogglePayload): void {
      ;(this as unknown as Record<string, unknown>)[type as string] = checked
    },

    TOGGLE_VIEW_MODE(entryName: keyof PreferencesState | string): void {
      const target = this as unknown as Record<string, unknown>
      target[entryName as string] = !target[entryName as string]
    },

    ASK_FOR_USER_PREFERENCE(): void {
      window.electron.ipcRenderer.send('mt::ask-for-user-preference')
      window.electron.ipcRenderer.send('mt::ask-for-user-data')

      window.electron.ipcRenderer.on('mt::user-preference', (_e, preferences) => {
        this.SET_USER_PREFERENCE(preferences as Partial<PreferencesState>)
      })
    },

    SET_SINGLE_PREFERENCE({ type, value }: SingleSetPreferencePayload): void {
      // 更新本地状态
      ;(this as unknown as Record<string, unknown>)[type as string] = value

      // 语言变更时更新 i18n
      if (type === 'language' && typeof value === 'string') {
        setLanguage(value)
      }

      // 写入 electron-store
      window.electron.ipcRenderer.send('mt::set-user-preference', { [type as string]: value })
    },

    SET_USER_DATA({ type, value }: SetUserDataPayload): void {
      window.electron.ipcRenderer.send('mt::set-user-data', { [type]: value })
    },

    SET_IMAGE_FOLDER_PATH(value?: string): void {
      window.electron.ipcRenderer.send('mt::ask-for-modify-image-folder-path', value)
    },

    SELECT_DEFAULT_DIRECTORY_TO_OPEN(): void {
      window.electron.ipcRenderer.send('mt::select-default-directory-to-open')
    },

    LISTEN_FOR_VIEW(): void {
      window.electron.ipcRenderer.on('mt::show-command-palette', () => {
        bus.emit('show-command-palette')
      })
      window.electron.ipcRenderer.on('mt::toggle-view-mode-entry', (_event, entryName) => {
        this.TOGGLE_VIEW_MODE(entryName)
        const target = this as unknown as Record<string, unknown>
        this.DISPATCH_EDITOR_VIEW_STATE({ [entryName]: target[entryName] })
      })
    },

    // 切换视图选项并通知主进程更新菜单项
    LISTEN_TOGGLE_VIEW(): void {
      bus.on('view:toggle-view-entry', (entryName) => {
        const name = entryName as string
        this.TOGGLE_VIEW_MODE(name)
        const target = this as unknown as Record<string, unknown>
        this.DISPATCH_EDITOR_VIEW_STATE({ [name]: target[name] })
      })
    },

    DISPATCH_EDITOR_VIEW_STATE(viewState: Record<string, unknown>): void {
      const { windowId } = window.marktext?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send('mt::view-layout-changed', windowId, viewState)
    }
  }
})
