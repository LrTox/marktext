import equal from 'deep-equal'
import bus from '../bus'
import { getUniqueId, deepClone } from '@/util'
import listToTree, { type ListItem, type TreeNode } from '../util/listToTree'
import {
  createDocumentState,
  getOptionsFromState,
  getBlankFileState,
  defaultFileState
} from './help'
import notice from '../services/notification'
import {
  FileEncodingCommand,
  LineEndingCommand,
  QuickOpenCommand,
  TrailingNewlineCommand
} from '../commands'
import { defineStore } from 'pinia'
import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { useMainStore } from '.'
import { t } from '@/i18n'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import type {
  IFileState,
  FileNotification,
  LineEnding,
  MarkdownDocument,
  PageOptions,
  TabOptions
} from '@shared/types/files'

// ----------------------------------------------------------------------------
// 本地辅助类型
// ----------------------------------------------------------------------------

interface TocItem extends ListItem {
  slug?: string
  githubSlug?: string
  content?: string
  lvl: number | null
}

type TocTreeNode = TreeNode<TocItem>

interface RestoreWarning {
  tabId?: string | null
  pathname?: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
}

interface PushTabNotificationPayload {
  tabId: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
  action?: FileNotification['action']
}

interface FileChangePayload {
  pathname: string
  data: {
    isMixedLineEndings?: boolean
    lineEnding?: LineEnding | string
    adjustLineEndingOnSave?: boolean
    trimTrailingNewline?: number
    encoding?: IFileState['encoding']
    markdown: string
    filename: string
  }
}

interface FormatLinkClickPayload {
  data: { href: string; [key: string]: unknown }
  dirname: string
}

interface ExportPayload {
  type: string
  content?: string
  pageOptions?: PageOptions
}

interface AutoSavePayload {
  id: string
  filename: string
  pathname: string
  markdown: string
  options: ReturnType<typeof getOptionsFromState>
}

interface ContentChangePayload {
  id: string
  markdown: string
  wordCount?: IFileState['wordCount']
  cursor?: unknown
  muyaIndexCursor?: unknown
  history?: IFileState['history']
  toc?: TocItem[]
  blocks?: unknown
}

interface AffiliationEntry {
  type: string
  functionType?: string
  listType?: string
  listItemType?: string
  isLooseListItem?: boolean
  [key: string]: unknown
}

interface SelectionChange {
  start: { key: string; offset: number; block?: { text?: string; functionType?: string }; type?: string }
  end: { key: string; offset: number; block?: { functionType?: string }; type?: string }
  affiliation?: AffiliationEntry[]
  hasFrontMatter?: boolean
}

interface SelectionFormat {
  type: string
  [key: string]: unknown
}

interface ProjectStoreLike {
  projectTree: { pathname?: string } | null
}

// ----------------------------------------------------------------------------
// 状态结构
// ----------------------------------------------------------------------------

export interface EditorState {
  currentFile: IFileState | null
  tabs: IFileState[]
  tabIdToIndex: Record<string, number>
  listToc: TocItem[]
  toc: TocTreeNode[]
}

const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

const handleExportSuccess = (
  _: unknown,
  payload: { type?: string; filePath?: string } | undefined
): void => {
  const filePath = payload?.filePath ?? ''
  notice
    .notify({
      title: t('store.editor.exportSuccessTitle'),
      message: t('store.editor.exportSuccessMessage', {
        name: window.path.basename(filePath)
      }),
      showConfirm: true
    })
    .then(() => {
      window.electron.shell.showItemInFolder(filePath)
    })
}

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    currentFile: null,
    tabs: [],
    tabIdToIndex: {},
    listToc: [], // 用于 equal 比较及查找跳转用的 github-slug
    toc: []
  }),

  actions: {
    updateTabIdToIndex(): void {
      this.tabIdToIndex = this.tabs.reduce<Record<string, number>>((map, tab, index) => {
        map[tab.id] = index
        return map
      }, {})
    },

    CREATE_BUFFERED_STATE(): ReturnType<typeof createBufferedEditorState> {
      return createBufferedEditorState(this.$state)
    },

    RESTORE_BUFFERED_STATE(state: unknown): void {
      const rawState = state as { editor?: unknown; project?: unknown; layout?: unknown } | null
      const editorInput = rawState?.editor ?? state
      const bufferedEditorState = createBufferedEditorState(editorInput)
      if (!bufferedEditorState) {
        console.error('RESTORE_BUFFERED_STATE: Invalid editor buffer state.')
        return
      }

      const oldIdToNewId: Record<string, string> = {}
      const tabs: IFileState[] = bufferedEditorState.tabs.map((tab) => {
        const fileState = createDocumentState(tab as unknown as Record<string, unknown>)
        oldIdToNewId[tab.id] = fileState.id
        return fileState
      })

      const currentFileId = bufferedEditorState.currentFileId
        ? oldIdToNewId[bufferedEditorState.currentFileId]
        : undefined
      const currentFile: IFileState | null = tabs.find((tab) => tab.id === currentFileId) ?? null

      const projectStore = useProjectStore()
      const layoutStore = useLayoutStore()

      projectStore.RESTORE_BUFFERED_STATE(rawState?.project)
      layoutStore.RESTORE_BUFFERED_STATE(rawState?.layout)
      this.$patch((s) => {
        s.tabs = tabs
        s.currentFile = currentFile
        s.tabIdToIndex = {}
        s.listToc = []
        s.toc = []
      })

      this.updateTabIdToIndex()
      window.DIRNAME = currentFile?.pathname ? window.path.dirname(currentFile.pathname) : ''
      this.UPDATE_LINE_ENDING_MENU()

      for (const warning of bufferedEditorState.restoreWarnings) {
        const restoredTabId = warning.tabId ? oldIdToNewId[warning.tabId] : null
        const tab = restoredTabId
          ? this.tabs.find((t) => t.id === restoredTabId)
          : this.tabs.find((t) =>
            window.fileUtils.isSamePathSync(t.pathname, warning.pathname ?? '')
          )

        if (!tab) continue

        this.pushTabNotification({
          tabId: tab.id,
          msg: warning.msg,
          showConfirm: warning.showConfirm,
          style: warning.style,
          exclusiveType: warning.exclusiveType
        })
      }
    },

    /**
     * 将指定标题的 github-slug 复制到剪贴板
     * @param key 标题 id
     */
    copyGithubSlug(key: string): void {
      const item = this.listToc.find((i) => i.slug === key)

      if (item) {
        window.electron.clipboard.writeText(`#${item.githubSlug}`)
        notice.notify({
          title: t('store.editor.anchorLinkCopied'),
          type: 'primary',
          time: 2000,
          showConfirm: false
        })
      } else {
        console.warn(t('store.editor.tocItemNotFound', { key }))
      }
    },

    /**
     * 更新 currentFile 的滚动位置
     */
    updateScrollPosition(id: string, scrollTop: number): void {
      if (!(id in this.tabIdToIndex)) {
        console.warn('updateScrollPosition: Cannot find tab index for id:', id)
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]]
      if (tab) {
        tab.scrollTop = scrollTop
      }
      debouncedSendBufferedState()
    },

    /**
     * 向标签页通知栈压入一条不会自动消失的通知
     */
    pushTabNotification(data: PushTabNotificationPayload): void {
      const defaultAction: FileNotification['action'] = () => {}
      const { tabId, msg } = data
      const action = data.action || defaultAction
      const showConfirm = data.showConfirm || false
      const style = data.style || 'info'
      // 是否只允许存在一条同类型通知
      const exclusiveType = data.exclusiveType || ''

      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) {
        console.error(t('store.editor.tabNotFound'))
        return
      }

      const { notifications } = tab

      // 若只允许一条，则移除旧通知
      if (exclusiveType) {
        const index = notifications.findIndex((n) => n.exclusiveType === exclusiveType)
        if (index >= 0) {
          // 将当前通知移到栈顶
          notifications.splice(index, 1)
        }
      }

      // 压入新通知
      notifications.push({
        msg,
        showConfirm,
        style,
        exclusiveType,
        action
      })
    },

    loadChange(change: FileChangePayload): void {
      const { tabs, currentFile } = this
      const { data, pathname } = change
      const {
        isMixedLineEndings,
        lineEnding,
        adjustLineEndingOnSave,
        trimTrailingNewline,
        encoding,
        markdown,
        filename
      } = data
      // 创建新文档，稍后更新部分字段
      const newFileState = createDocumentState({
        markdown,
        filename,
        pathname,
        encoding,
        lineEnding,
        adjustLineEndingOnSave,
        trimTrailingNewline
      })

      const tab = tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, pathname))
      if (!tab) {
        // 期间标签可能已被关闭
        console.error('loadChange: Cannot find tab in tab list.')
        notice.notify({
          title: t('store.editor.errorLoadingTabTitle'),
          message: t('store.editor.errorLoadingTabMessage'),
          type: 'error',
          time: 20000,
          showConfirm: false
        })
        return
      }

      // 备份稍后需要恢复的字段
      const oldId = tab.id
      const oldNotifications = tab.notifications
      // 外部重载时保留滚动位置，避免编辑器跳动
      const oldScrollTop = tab.scrollTop
      let oldHistory: IFileState['history'] | null = null
      const histIndex = tab.history.index
      if (histIndex >= 0 && tab.history.stack.length >= 1) {
        const entry = tab.history.stack[histIndex]
        if (entry) {
          // 允许恢复旧文档
          oldHistory = {
            stack: [entry],
            index: 0
          }
        }

        // 释放数组引用
        tab.history.index--
        tab.history.stack.pop()
      }

      // 更新文件内容并恢复部分字段
      Object.assign(tab, newFileState)
      tab.id = oldId
      tab.notifications = oldNotifications
      tab.scrollTop = oldScrollTop
      if (oldHistory) {
        tab.history = oldHistory
      }

      if (isMixedLineEndings && typeof lineEnding === 'string') {
        this.pushTabNotification({
          tabId: tab.id,
          msg: t('store.editor.mixedLineEndingsNormalized', {
            name: filename,
            lineEnding: lineEnding.toUpperCase()
          }),
          showConfirm: false,
          style: 'info',
          exclusiveType: ''
        })
      }

      // 若当前打开该标签则重载编辑器
      if (currentFile && pathname === currentFile.pathname) {
        // 先保存当前状态
        this.currentFile = tab
        const { id, cursor, history, scrollTop, muyaIndexCursor } = tab // 不应使用 blocks history，内容来自磁盘
        bus.emit('file-changed', {
          id,
          markdown,
          muyaIndexCursor,
          cursor,
          renderCursor: true,
          history,
          scrollTop
        })
      }
      debouncedSendBufferedState()
    },

    FORMAT_LINK_CLICK({ data, dirname }: FormatLinkClickPayload): void {
      // 链接以 # 开头则为本地锚点
      if (data.href.length > 0 && data.href[0] === '#') {
        const anchorSlug = data.href.substring(1)
        if (!anchorSlug) return

        // 从 TOC 查找匹配 anchor slug 的块
        for (const item of this.listToc) {
          if (item.githubSlug === anchorSlug) {
            // 滚动到对应 github-slug 元素
            bus.emit('scroll-to-header', item.slug)
            return
          }
        }

        return
      }

      window.electron.ipcRenderer.send('mt::format-link-click', { data, dirname })
    },

    LISTEN_SCREEN_SHOT(): void {
      window.electron.ipcRenderer.on('mt::screenshot-captured', (_, filePath) => {
        bus.emit('screenshot-captured', filePath)
      })
    },

    // 图片路径自动补全
    ASK_FOR_IMAGE_AUTO_PATH(src: string): Promise<string[]> {
      if (!this.currentFile) return Promise.resolve([])
      const { pathname } = this.currentFile
      if (pathname) {
        let rs: (value: string[]) => void = () => {}
        const promise = new Promise<string[]>((resolve) => {
          rs = resolve
        })
        const id = getUniqueId()
        // 动态 IPC 通道 —— 不在静态 IpcMainEventChannels 契约中
        ;(
          window.electron.ipcRenderer.once as (
            channel: string,
            listener: (event: unknown, files: string[]) => void
          ) => void
        )(`mt::response-of-image-path-${id}`, (_: unknown, files: string[]) => {
          rs(files)
        })
        window.electron.ipcRenderer.send('mt::ask-for-image-auto-path', {
          pathname,
          src,
          id,
          currentFile: deepClone(this.currentFile)
        })
        return promise
      } else {
        return Promise.resolve([])
      }
    },

    SEARCH(value: IFileState['searchMatches']): void {
      if (!this.currentFile) return
      this.currentFile.searchMatches = deepClone(value) // 深拷贝以触发状态变更
    },

    SHOW_IMAGE_DELETION_URL(deletionUrl: string): void {
      notice
        .notify({
          title: t('store.editor.imageDeletionUrlTitle'),
          message: t('store.editor.imageDeletionUrlMessage', { url: deletionUrl }),
          showConfirm: true,
          time: 20000
        })
        .then(() => {
          window.electron.clipboard.writeText(deletionUrl)
        })
    },

    // 切换标签时需更新行尾菜单
    UPDATE_LINE_ENDING_MENU(): void {
      if (!this.currentFile) return
      const { lineEnding } = this.currentFile
      if (lineEnding) {
        const { windowId } = window.marktext?.env ?? { windowId: -1 }
        window.electron.ipcRenderer.send(
          'mt::update-line-ending-menu',
          windowId,
          lineEnding as LineEnding
        )
      }
    },

    FILE_SAVE(): void {
      if (!this.currentFile) return
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)
      if (id) {
        window.electron.ipcRenderer.send(
          'mt::response-file-save',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      }
    },

    // 点击「保存」菜单时需向主进程传递数据
    LISTEN_FOR_SAVE(): void {
      window.electron.ipcRenderer.on('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
      bus.on('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
    },

    FILE_SAVE_AS(): void {
      if (!this.currentFile) return
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)

      if (id) {
        window.electron.ipcRenderer.send(
          'mt::response-file-save-as',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      }
    },

    // 点击「另存为」菜单时需向主进程传递数据
    LISTEN_FOR_SAVE_AS(): void {
      window.electron.ipcRenderer.on('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
      bus.on('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
    },

    LISTEN_FOR_SET_PATHNAME(): void {
      window.electron.ipcRenderer.on('mt::set-pathname', (_, fileInfo) => {
        const { tabs } = this
        const { pathname, id } = fileInfo
        const tab = tabs.find((f) => f.id === id)
        if (!tab) {
          console.error('[ERROR] Cannot change file path from unknown tab.')
          return
        }

        // 若已有同路径标签则关闭；当前标签将覆盖该标签
        const existingTab = tabs.find(
          (t) => t.id !== id && window.fileUtils.isSamePathSync(t.pathname, pathname)
        )
        if (existingTab) {
          this.CLOSE_TAB(existingTab)
        }

        // 设置路径名
        const { filename } = fileInfo
        if (id === this.currentFile?.id && pathname) {
          window.DIRNAME = window.path.dirname(pathname)
        }
        if (tab) {
          Object.assign(tab, { filename, pathname, isSaved: true })
          debouncedSendBufferedState()
        }
      })

      window.electron.ipcRenderer.on('mt::tab-saved', (_, tabId) => {
        const tab = this.tabs.find((f) => f.id === tabId)
        if (tab) {
          const lastEditIndex = tab.history.lastEditIndex
          if (
            typeof lastEditIndex === 'number' &&
            lastEditIndex >= 0 &&
            lastEditIndex < tab.history.stack.length
          ) {
            const entry = tab.history.stack[lastEditIndex]
            if (entry && typeof entry.id === 'number') {
              tab.lastSavedHistoryId = entry.id
            }
          }
          tab.isSaved = true
          debouncedSendBufferedState()
        }
      })

      window.electron.ipcRenderer.on('mt::tab-save-failure', (_, tabId, msg) => {
        const tab = this.tabs.find((t) => t.id === tabId)
        if (!tab) {
          notice.notify({
            title: t('dialog.saveFailure'),
            message: msg,
            type: 'error',
            time: 20000,
            showConfirm: false
          })
          return
        }

        tab.isSaved = false
        this.pushTabNotification({
          tabId,
          msg: t('store.editor.errorWhileSaving', { msg }),
          style: 'crit'
        })
        debouncedSendBufferedState()
      })
    },

    LISTEN_FOR_CLOSE(): void {
      const projectStore = useProjectStore()
      const preferencesStore = usePreferencesStore()
      window.electron.ipcRenderer.on('mt::ask-for-close', () => {
        sendBufferedState()
          .catch((err) => {
            console.error('Failed to update buffered state before closing', err)
          })
          .then(() => {
            const unsavedFiles = this.tabs
              .filter((file) => !file.isSaved)
              .map((file) => {
                const { id, filename, pathname, markdown } = file
                const options = getOptionsFromState(file)
                return {
                  id,
                  filename,
                  pathname,
                  markdown,
                  options,
                  defaultPath: getRootFolderFromState(projectStore)
                }
              })

            if (unsavedFiles.length && preferencesStore.startUpAction !== 'restoreAll') {
              // 启动操作为 restoreAll 时忽略未保存文件（启动时会恢复）
              window.electron.ipcRenderer.send('mt::close-window-confirm', deepClone(unsavedFiles))
            } else {
              window.electron.ipcRenderer.send('mt::close-window')
            }
          })
      })
    },

    LISTEN_FOR_SAVE_CLOSE(): void {
      window.electron.ipcRenderer.on('mt::force-close-tabs-by-id', (_, tabIdList) => {
        if (Array.isArray(tabIdList) && tabIdList.length) {
          this.CLOSE_TABS(tabIdList)
        }
      })
    },

    ASK_FOR_SAVE_ALL(closeTabs: boolean): void {
      const { tabs } = this
      const projectStore = useProjectStore()
      const unsavedFiles = tabs
        .filter((file) => !(file.isSaved && /[^\n]/.test(file.markdown)))
        .map((file) => {
          const { id, filename, pathname, markdown } = file
          const options = getOptionsFromState(file)
          return {
            id,
            filename,
            pathname,
            markdown,
            options,
            defaultPath: getRootFolderFromState(projectStore)
          }
        })

      if (closeTabs) {
        if (unsavedFiles.length) {
          this.CLOSE_TABS(tabs.filter((f) => f.isSaved).map((f) => f.id))
          window.electron.ipcRenderer.send('mt::save-and-close-tabs', deepClone(unsavedFiles))
        } else {
          this.CLOSE_TABS(tabs.map((f) => f.id))
        }
      } else {
        window.electron.ipcRenderer.send('mt::save-tabs', deepClone(unsavedFiles))
      }
    },

    MOVE_FILE_TO(): void {
      if (!this.currentFile) return
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)
      if (!id) return
      if (!pathname) {
        // 新建未保存文件则直接保存
        window.electron.ipcRenderer.send(
          'mt::response-file-save',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      } else {
        // 否则移动到新（可能不同的）文件夹
        window.electron.ipcRenderer.send('mt::response-file-move-to', { id, pathname })
      }
    },

    LISTEN_FOR_MOVE_TO(): void {
      window.electron.ipcRenderer.on('mt::editor-move-file', () => {
        this.MOVE_FILE_TO()
      })
      bus.on('mt::editor-move-file', () => {
        this.MOVE_FILE_TO()
      })
    },

    LISTEN_FOR_RENAME(): void {
      window.electron.ipcRenderer.on('mt::editor-rename-file', () => {
        this.RESPONSE_FOR_RENAME()
      })
      bus.on('mt::editor-rename-file', () => {
        this.RESPONSE_FOR_RENAME()
      })
    },

    RESPONSE_FOR_RENAME(): void {
      if (!this.currentFile) return
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)
      if (!id) return
      if (!pathname) {
        // 新建未保存文件则直接保存
        window.electron.ipcRenderer.send(
          'mt::response-file-save',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      } else {
        bus.emit('rename')
      }
    },

    // 请求主进程将文件重命名为 newFilename
    RENAME(newFilename: string): void {
      if (!this.currentFile) return
      const { id, pathname, filename } = this.currentFile
      if (typeof filename === 'string' && filename !== newFilename) {
        const newPathname = window.path.join(window.path.dirname(pathname), newFilename)
        window.electron.ipcRenderer.send('mt::rename', {
          id,
          pathname,
          newPathname,
          currentFile: deepClone(this.currentFile)
        })
      }
    },

    /**
     * 更新 pathname 与 `src` 匹配的所有标签页路径/文件名。
     * 由侧边栏重命名流程调用（project.ts:RENAME_IN_SIDEBAR）。
     */
    RENAME_IF_NEEDED({ src, dest }: { src: string; dest: string }): void {
      this.tabs.forEach((tab) => {
        if (tab.pathname === src) {
          tab.pathname = dest
          tab.filename = window.path.basename(dest)
        }
      })
      // 活动标签被重命名时同步 DIRNAME，避免链接解析仍用旧目录直至切换标签
      if (this.currentFile != null && this.currentFile.pathname === dest) {
        window.DIRNAME = window.path.dirname(dest)
      }
      debouncedSendBufferedState()
    },

    UPDATE_CURRENT_FILE(currentFile: IFileState): void {
      const oldCurrentFile = this.currentFile
      let didUpdateCurrentFile = false
      if (oldCurrentFile == null || oldCurrentFile.id !== currentFile.id) {
        const { id, markdown, cursor, history, pathname, scrollTop, blocks, muyaIndexCursor } =
          currentFile
        window.DIRNAME = pathname ? window.path.dirname(pathname) : ''
        this.currentFile = currentFile
        didUpdateCurrentFile = true

        if (!this.tabs.some((file) => file.id === currentFile.id)) {
          this.tabs.push(currentFile)
          this.updateTabIdToIndex()
        }

        bus.emit('file-changed', {
          id,
          markdown,
          cursor,
          muyaIndexCursor,
          renderCursor: true,
          history,
          scrollTop,
          blocks
        })
      }

      this.UPDATE_LINE_ENDING_MENU()
      if (didUpdateCurrentFile) {
        debouncedSendBufferedState()
      }
    },

    // 仅在窗口创建期间使用这些事件
    LISTEN_FOR_BOOTSTRAP_WINDOW(): void {
      const preferencesStore = usePreferencesStore()
      const layoutStore = useLayoutStore()
      const projectStore = useProjectStore()
      const mainStore = useMainStore()

      // 延迟加载运行时命令并注册
      setTimeout(() => {
        bus.emit('cmd::register-command', new FileEncodingCommand(this))
        bus.emit(
          'cmd::register-command',
          new QuickOpenCommand({
            editor: this,
            preferences: preferencesStore,
            project: projectStore
          })
        )
        bus.emit(
          'cmd::register-command',
          new LineEndingCommand(this)
        )
        bus.emit(
          'cmd::register-command',
          new TrailingNewlineCommand(this)
        )

        setTimeout(() => {
          window.electron.ipcRenderer.send('mt::request-keybindings')
          bus.emit('cmd::sort-commands')
        }, 100)
      }, 400)

      window.electron.ipcRenderer.on('mt::bootstrap-editor', (_, config) => {
        const {
          addBlankTab,
          markdownList,
          lineEnding,
          sideBarVisibility,
          tabBarVisibility,
          sourceCodeModeEnabled
        } = config

        window.electron.ipcRenderer.send('mt::window-initialized')
        mainStore.SET_INITIALIZED()
        preferencesStore.SET_USER_PREFERENCE({ endOfLine: lineEnding })
        layoutStore.SET_LAYOUT({
          rightColumn: 'files',
          showSideBar: sideBarVisibility,
          showTabBar: tabBarVisibility
        })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
        preferencesStore.SET_MODE({
          type: 'sourceCode',
          checked: sourceCodeModeEnabled
        })

        if (addBlankTab) {
          this.NEW_UNTITLED_TAB({ selected: true })
        } else if (markdownList.length) {
          let isFirst = true
          for (const md of markdownList) {
            this.NEW_UNTITLED_TAB({
              markdown: md,
              selected: isFirst
            })
            isFirst = false
          }
        }
      })
    },

    // 打开新标签，可选带内容
    LISTEN_FOR_NEW_TAB(): void {
      window.electron.ipcRenderer.on(
        'mt::open-new-tab',
        (_, markdownDocument, options = {}, selected = true) => {
          if (markdownDocument) {
            // 带内容创建标签
            this.NEW_TAB_WITH_CONTENT({ markdownDocument, options, selected })
          } else {
            // 回退：创建空白标签并选中
            this.NEW_UNTITLED_TAB({})
          }
        }
      )

      window.electron.ipcRenderer.on(
        'mt::new-untitled-tab',
        (_, selected = true, markdown = '') => {
          // 创建空白标签
          this.NEW_UNTITLED_TAB({ markdown, selected })
        }
      )
      bus.on('mt::new-untitled-tab', (payload) => {
        const { selected = true, markdown = '' } =
          (payload as { selected?: boolean; markdown?: string } | undefined) ?? {}
        this.NEW_UNTITLED_TAB({ markdown, selected })
      })
    },

    CLOSE_TAB(file: IFileState | null = null): void {
      const target = file ?? this.currentFile
      if (target === null) return

      if (target.isSaved) {
        this.FORCE_CLOSE_TAB(target)
      } else {
        this.CLOSE_UNSAVED_TAB(target)
      }
    },

    LISTEN_FOR_CLOSE_TAB(): void {
      window.electron.ipcRenderer.on('mt::editor-close-tab', () => {
        this.CLOSE_TAB()
      })
      bus.on('mt::editor-close-tab', () => {
        this.CLOSE_TAB()
      })
    },

    LISTEN_FOR_TAB_CYCLE(): void {
      window.electron.ipcRenderer.on('mt::tabs-cycle-left', () => {
        this.CYCLE_TABS(false)
      })
      window.electron.ipcRenderer.on('mt::tabs-cycle-right', () => {
        this.CYCLE_TABS(true)
      })
      bus.on('mt::tabs-cycle-left', () => {
        this.CYCLE_TABS(false)
      })
      bus.on('mt::tabs-cycle-right', () => {
        this.CYCLE_TABS(true)
      })
    },

    LISTEN_FOR_SWITCH_TABS(): void {
      window.electron.ipcRenderer.on('mt::switch-tab-by-index', (_, index) => {
        this.SWITCH_TAB_BY_INDEX(index)
      })
      window.electron.ipcRenderer.on('mt::switch-tab-by-file_path', (_, filePath) => {
        this.SWITCH_TAB_BY_FILEPATH(filePath)
      })
    },

    FORCE_CLOSE_TAB(file: IFileState): void {
      const { tabs, currentFile } = this
      const index = tabs.findIndex((t) => t.id === file.id)
      if (index > -1) {
        tabs.splice(index, 1)
        this.updateTabIdToIndex()
      }

      if (file.id && autoSaveTimers.has(file.id)) {
        const timer = autoSaveTimers.get(file.id)
        if (timer) clearTimeout(timer)
        autoSaveTimers.delete(file.id)
      }

      this.updateTabIdToIndex() // 发送前先更新，避免映射过期

      if (currentFile && file.id === currentFile.id) {
        const fileState: IFileState | null =
          this.tabs[index] ?? this.tabs[index - 1] ?? this.tabs[0] ?? null
        this.currentFile = fileState
        if (fileState && typeof fileState.markdown === 'string') {
          const { id, markdown, cursor, history, pathname, scrollTop, blocks, muyaIndexCursor } =
            fileState
          window.DIRNAME = pathname ? window.path.dirname(pathname) : ''
          bus.emit('file-changed', {
            id,
            markdown,
            cursor,
            muyaIndexCursor,
            renderCursor: true,
            history,
            scrollTop,
            blocks
          })
        } else {
          window.DIRNAME = ''
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }

      const { pathname } = file
      if (pathname) {
        window.electron.ipcRenderer.send('mt::window-tab-closed', pathname)
      }
      debouncedSendBufferedState()
    },

    CLOSE_UNSAVED_TAB(file: IFileState): void {
      const { id, pathname, filename, markdown } = file
      const options = getOptionsFromState(file)
      window.electron.ipcRenderer.send('mt::save-and-close-tabs', [
        { id, pathname, filename, markdown, options: deepClone(options) }
      ])
    },

    CLOSE_OTHER_TABS(file: IFileState): void {
      this.tabs
        .filter((f) => f.id !== file.id)
        .forEach((tab) => {
          this.CLOSE_TAB(tab)
        })
    },

    CLOSE_SAVED_TABS(): void {
      this.tabs
        .filter((f) => f.isSaved)
        .forEach((tab) => {
          this.CLOSE_TAB(tab)
        })
    },

    CLOSE_ALL_TABS(): void {
      this.tabs.slice().forEach((tab) => {
        this.CLOSE_TAB(tab)
      })
    },

    CLOSE_TABS(tabIdList: string[]): void {
      if (!tabIdList || tabIdList.length === 0) return

      let tabIndex = 0
      tabIdList.forEach((id) => {
        const index = this.tabs.findIndex((f) => f.id === id)
        if (index === -1) return

        const closed = this.tabs[index]
        const { pathname } = closed ?? { pathname: '' }

        if (pathname) {
          window.electron.ipcRenderer.send('mt::window-tab-closed', pathname)
        }

        this.tabs.splice(index, 1)
        if (this.currentFile?.id === id) {
          this.currentFile = null
          window.DIRNAME = ''
          if (tabIdList.length === 1) {
            tabIndex = index
          }
        }
      })

      this.updateTabIdToIndex() // 发送前先更新，避免映射过期

      if (this.currentFile == null && this.tabs.length > 0) {
        this.currentFile =
          this.tabs[tabIndex] ?? this.tabs[tabIndex - 1] ?? this.tabs[0] ?? null
        if (this.currentFile && typeof this.currentFile.markdown === 'string') {
          const { id, markdown, cursor, history, pathname, scrollTop, blocks, muyaIndexCursor } =
            this.currentFile
          window.DIRNAME = pathname ? window.path.dirname(pathname) : ''
          bus.emit('file-changed', {
            id,
            markdown,
            cursor,
            muyaIndexCursor,
            renderCursor: true,
            history,
            scrollTop,
            blocks
          })
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }
      debouncedSendBufferedState()
    },

    EXCHANGE_TABS_BY_ID(tabIDs: { fromId: string; toId: string | null }): void {
      const { fromId, toId } = tabIDs
      const { tabs } = this
      const moveItem = <T>(arr: T[], from: number, to: number): boolean => {
        if (from === to) return true
        const len = arr.length
        const item = arr.splice(from, 1)
        if (item.length === 0) return false

        arr.splice(to, 0, item[0]!)
        return arr.length === len
      }

      const fromIndex = tabs.findIndex((t) => t.id === fromId)
      if (fromIndex === -1) return

      if (!toId) {
        moveItem(tabs, fromIndex, tabs.length - 1)
      } else {
        const toIndex = tabs.findIndex((t) => t.id === toId)
        if (toIndex === -1) return
        const realToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
        moveItem(tabs, fromIndex, realToIndex)
      }
      this.updateTabIdToIndex()
      debouncedSendBufferedState()
    },

    RENAME_FILE(file: IFileState): void {
      this.UPDATE_CURRENT_FILE(file)
      bus.emit('rename')
    },

    // direction 为 boolean：false 向左，true 向右
    CYCLE_TABS(direction: boolean): void {
      const { tabs, currentFile } = this
      if (tabs.length <= 1) {
        return
      }

      const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
      if (currentIndex === -1) {
        console.error('CYCLE_TABS: Cannot find current tab index.')
        return
      }

      let nextTabIndex = 0
      if (!direction) {
        // 向左切换标签
        nextTabIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1
      } else {
        // 向右切换标签
        nextTabIndex = (currentIndex + 1) % tabs.length
      }

      const nextTab = tabs[nextTabIndex]
      if (!nextTab || !nextTab.id) {
        console.error(`CYCLE_TABS: Cannot find next tab (index="${nextTabIndex}").`)
        return
      }

      this.UPDATE_CURRENT_FILE(nextTab)
    },

    SWITCH_TAB_BY_FILEPATH(filePath: string): void {
      const { tabs } = this

      if (!filePath) {
        console.warn('Invalid file path:', filePath)
        return
      }

      const nextTabIndex = tabs.findIndex((t) => t.pathname === filePath)
      if (nextTabIndex === -1) {
        console.error('Cannot find tab with pathname:', filePath)
        return
      }
      const next = tabs[nextTabIndex]
      if (next) this.UPDATE_CURRENT_FILE(next)
    },

    SWITCH_TAB_BY_INDEX(nextTabIndex: number): void {
      const { tabs, currentFile } = this
      if (nextTabIndex < 0 || nextTabIndex >= tabs.length) {
        console.warn('Invalid tab index:', nextTabIndex)
        return
      }

      const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
      if (currentIndex === -1) {
        console.error('Cannot find current tab index.')
        return
      }

      const nextTab = tabs[nextTabIndex]
      if (!nextTab || !nextTab.id) {
        console.error(`Cannot find tab by index="${nextTabIndex}".`)
        return
      }
      this.UPDATE_CURRENT_FILE(nextTab)
    },

    /**
     * 创建新的未命名标签，可选预填 markdown
     */
    NEW_UNTITLED_TAB({
      markdown: markdownString,
      selected
    }: { markdown?: string; selected?: boolean }): void {
      if (selected == null) {
        selected = true
      }

      this.SHOW_TAB_VIEW(false)

      const preferencesStore = usePreferencesStore()
      const { defaultEncoding, endOfLine } = preferencesStore
      const fileState = getBlankFileState(
        this.tabs,
        defaultEncoding,
        endOfLine,
        markdownString ?? null
      )

      if (selected) {
        const { id, markdown } = fileState
        this.UPDATE_CURRENT_FILE(fileState)
        bus.emit('file-loaded', { id, markdown })
      } else {
        this.tabs.push(fileState)
        this.updateTabIdToIndex()
        debouncedSendBufferedState()
      }
    },

    /**
     * 从给定 markdown 文档创建新标签
     */
    NEW_TAB_WITH_CONTENT({
      markdownDocument,
      options = {},
      selected
    }: {
      markdownDocument: MarkdownDocument | null | undefined
      options?: TabOptions
      selected?: boolean
    }): void {
      if (!markdownDocument) {
        console.warn('Cannot create a file tab without a markdown document!')
        this.NEW_UNTITLED_TAB({})
        return
      }

      if (typeof selected === 'undefined') {
        selected = true
      }

      const { currentFile, tabs } = this
      const { pathname } = markdownDocument
      const existingTab = tabs.find((t) =>
        window.fileUtils.isSamePathSync(t.pathname, pathname ?? '')
      )
      if (existingTab) {
        this.UPDATE_CURRENT_FILE(existingTab)
        return
      }

      let keepTabBarState = false
      if (currentFile) {
        const { isSaved, pathname: cfPath } = currentFile
        if (isSaved && !cfPath) {
          keepTabBarState = true
          this.FORCE_CLOSE_TAB(currentFile)
        }
      }

      if (!keepTabBarState) {
        this.SHOW_TAB_VIEW(false)
      }

      const { markdown, isMixedLineEndings } = markdownDocument
      const docState = createDocumentState(
        Object.assign(
          {},
          markdownDocument as unknown as Record<string, unknown>,
          options as Record<string, unknown>
        )
      )
      const { id, cursor } = docState

      if (selected) {
        this.UPDATE_CURRENT_FILE(docState)
        bus.emit('file-loaded', { id, markdown, cursor })
      } else {
        this.tabs.push(docState)
        this.updateTabIdToIndex()
        debouncedSendBufferedState()
      }

      if (isMixedLineEndings) {
        const { filename, lineEnding } = markdownDocument
        if (typeof lineEnding === 'string') {
          this.pushTabNotification({
            tabId: id,
            msg: t('store.editor.mixedLineEndingsNormalized', {
              name: filename,
              lineEnding: lineEnding.toUpperCase()
            })
          })
        }
      }
    },

    SHOW_TAB_VIEW(always: boolean): void {
      const { tabs } = this
      const layoutStore = useLayoutStore()
      if (always || tabs.length === 1) {
        layoutStore.SET_LAYOUT({ showTabBar: true })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
      }
    },

    SET_SAVE_STATUS_WHEN_REMOVE({ pathname }: { pathname: string }): void {
      let didUpdateSaveStatus = false
      this.tabs.forEach((f) => {
        if (f.pathname === pathname) {
          f.isSaved = false
          didUpdateSaveStatus = true
        }
      })
      if (didUpdateSaveStatus) {
        debouncedSendBufferedState()
      }
    },

    /**
     * 用引擎最新快照替换目录（TOC）。
     *
     * 用于文件加载与标签切换：此时引擎不触发 `json-change`，
     * `LISTEN_FOR_CONTENT_CHANGE` 不会运行，TOC 会空至首次编辑。
     * 无条件赋值 —— 这是加载/切换时的重播种，无 `equal` 短路；
     *  incoming 快照始终生效，即使与当前 TOC 深相等。
     * @param toc `muya.getTOC()` 返回的扁平标题列表
     */
    UPDATE_TOC(toc: TocItem[]): void {
      this.listToc = toc ?? []
      this.toc = listToTree<TocItem>(toc ?? [])
    },

    // 实时预览与源码编辑器的 content change
    // 可能在标签切换之后才触发
    LISTEN_FOR_CONTENT_CHANGE({
      id,
      markdown,
      wordCount,
      cursor,
      muyaIndexCursor,
      history,
      toc,
      blocks
    }: ContentChangePayload): void {
      const preferencesStore = usePreferencesStore()
      const { autoSave } = preferencesStore
      if (!id) {
        throw new Error('Listen for document change but id was not set!')
      } else if (this.tabs.length === 0) {
        return
      } else if (!(id in this.tabIdToIndex)) {
        // 仅当 sourceCode 通过 prepareTabSwitch() 写入过期 id 但标签已关闭时发生，可安全忽略
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]!]
      if (!tab) return

      const { filename, pathname, markdown: oldMarkdown, trimTrailingNewline } = tab

      markdown = adjustTrailingNewlines(markdown, trimTrailingNewline)
      tab.markdown = markdown

      if (oldMarkdown.length === 0 && markdown.length === 1 && markdown[0] === '\n') {
        debouncedSendBufferedState()
        return
      }

      if (wordCount) tab.wordCount = wordCount
      if (cursor) tab.cursor = cursor
      if (muyaIndexCursor) tab.muyaIndexCursor = muyaIndexCursor
      if (history) tab.history = history
      if (blocks) tab.blocks = blocks

      // 仅当前文件时更新 TOC
      if (id === this.currentFile?.id && toc && !equal(toc, this.listToc)) {
        this.listToc = toc
        this.toc = listToTree<TocItem>(toc)
      }

      const lastEditIndex = tab.history.lastEditIndex
      const editEntry =
        typeof lastEditIndex === 'number' && lastEditIndex >= 0
          ? tab.history.stack[lastEditIndex]
          : undefined
      if (
        (typeof lastEditIndex === 'number' &&
          lastEditIndex >= 0 &&
          editEntry !== undefined &&
          editEntry.id !== tab.lastSavedHistoryId) ||
        (lastEditIndex === -1 &&
          tab.lastSavedHistoryId !== -1 &&
          tab.lastSavedHistoryId !== tab.history.lastInitIndex) // 边界：撤销到原始内容（lastEditIndex === -1）保存后无法用 lastEditIndex，改与 lastInitIndex 比较
      ) {
        tab.isSaved = false
        if (pathname && autoSave) {
          const options = getOptionsFromState(tab)
          this.HANDLE_AUTO_SAVE({
            id,
            filename,
            pathname,
            markdown,
            options
          })
        }
      } else if (tab.lastSavedHistoryId !== -1) {
        // 防止覆盖已恢复的 .isSaved 状态
        tab.isSaved = true // 撤销可能触发此分支
      }
      debouncedSendBufferedState()
    },

    HANDLE_AUTO_SAVE({ id, filename, pathname, markdown, options }: AutoSavePayload): void {
      if (!id || !pathname) {
        throw new Error('HANDLE_AUTO_SAVE: Invalid tab.')
      }

      const preferencesStore = usePreferencesStore()
      const projectStore = useProjectStore()
      const { autoSaveDelay } = preferencesStore

      if (autoSaveTimers.has(id)) {
        const timer = autoSaveTimers.get(id)
        clearTimeout(timer)
        autoSaveTimers.delete(id)
      }

      const timer = setTimeout(() => {
        autoSaveTimers.delete(id)

        const tab = this.tabs.find((t) => t.id === id)
        if (tab && !tab.isSaved) {
          const defaultPath = getRootFolderFromState(projectStore)
          window.electron.ipcRenderer.send(
            'mt::response-file-save',
            id,
            filename,
            pathname,
            markdown,
            deepClone(options),
            defaultPath
          )
        }
      }, autoSaveDelay)
      autoSaveTimers.set(id, timer)
    },

    SELECTION_CHANGE(changes: SelectionChange): void {
      const { start, end } = changes
      if (this.currentFile && start.key === end.key && start.block?.text) {
        const value = start.block.text.substring(start.offset, end.offset)
        this.currentFile.searchMatches = {
          matches: [],
          index: -1,
          value
        }
      }

      const { windowId } = window.marktext?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send(
        'mt::editor-selection-changed',
        windowId,
        createApplicationMenuState(changes)
      )
    },

    // 持久化标签 caret，不走重量级 content-change 流水线。
    // 纯 caret 移动（点击/方向键）触发 `selection-change` 而非 `json-change`，
    // `tab.cursor`（标签再激活时回放的位置）否则只跟踪最后一次编辑，
    // 会话内切换标签会丢失点击移动的光标。设计上仅存储序列化 caret，
    // 跳过 markdown/blocks/TOC 重算及 LISTEN_FOR_CONTENT_CHANGE 的脏标记逻辑。
    PERSIST_CURSOR(id: string, cursor: unknown): void {
      if (!id || !cursor) return
      const index = this.tabIdToIndex[id]
      if (index == null) return
      const tab = this.tabs[index]
      if (tab) tab.cursor = cursor
    },

    SELECTION_FORMATS(formats: SelectionFormat[]): void {
      const { windowId } = window.marktext?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send(
        'mt::update-format-menu',
        windowId,
        createSelectionFormatState(formats)
      )
    },

    EXPORT({ type, content, pageOptions }: ExportPayload): void {
      if (this.currentFile === null) return

      let title = ''
      const { listToc } = this
      if (listToc && listToc.length > 0) {
        let headerRef: TocItem | undefined = listToc[0]
        const len = Math.min(listToc.length, 6)
        for (let i = 1; i < len; ++i) {
          if (headerRef?.lvl === 1) break
          const header = listToc[i]
          if (header && headerRef && (headerRef.lvl ?? 0) > (header.lvl ?? 0)) {
            headerRef = header
          }
        }
        title = headerRef?.content ?? ''
      }

      const { filename, pathname } = this.currentFile
      window.electron.ipcRenderer.send('mt::response-export', {
        type: type as ExportPayload['type'] as never,
        title,
        content: content ?? '',
        filename,
        pathname,
        pageOptions: pageOptions ?? {}
      })
    },

    LISTEN_FOR_EXPORT_SUCCESS(): void {
      window.electron.ipcRenderer.removeAllListeners('mt::export-success')
      window.electron.ipcRenderer.on('mt::export-success', handleExportSuccess)
    },

    PRINT_RESPONSE(): void {
      window.electron.ipcRenderer.send('mt::response-print')
    },

    LISTEN_FOR_PRINT_SERVICE_CLEARUP(): void {
      window.electron.ipcRenderer.on('mt::print-service-clearup', () => {
        bus.emit('print-service-clearup')
      })
    },

    SET_LINE_ENDING(lineEnding: LineEnding | string): void {
      if (!this.currentFile) return
      const { lineEnding: oldLineEnding } = this.currentFile
      if (lineEnding !== oldLineEnding) {
        this.currentFile.lineEnding = lineEnding
        this.currentFile.adjustLineEndingOnSave = lineEnding !== 'lf'
        this.currentFile.isSaved = true
        this.UPDATE_LINE_ENDING_MENU()
        debouncedSendBufferedState()
      }
    },

    LISTEN_FOR_SET_LINE_ENDING(): void {
      window.electron.ipcRenderer.on('mt::set-line-ending', (_, lineEnding) => {
        this.SET_LINE_ENDING(lineEnding)
      })
      bus.on('mt::set-line-ending', (lineEnding) => {
        this.SET_LINE_ENDING(lineEnding as LineEnding)
      })
    },

    LISTEN_FOR_SET_ENCODING(): void {
      bus.on('mt::set-file-encoding', (encodingName) => {
        if (!this.currentFile) return
        const { encoding } = this.currentFile.encoding
        if (encoding !== encodingName) {
          this.currentFile.encoding.encoding = encodingName as string
          this.currentFile.encoding.isBom = false
          this.currentFile.isSaved = true
          debouncedSendBufferedState()
        }
      })
    },

    LISTEN_FOR_SET_FINAL_NEWLINE(): void {
      bus.on('mt::set-final-newline', (value) => {
        if (!this.currentFile) return
        const { trimTrailingNewline } = this.currentFile
        if (trimTrailingNewline !== value) {
          this.currentFile.trimTrailingNewline = value as number
          this.currentFile.isSaved = true
          debouncedSendBufferedState()
        }
      })
    },

    LISTEN_FOR_FILE_CHANGE(): void {
      const preferencesStore = usePreferencesStore()
      window.electron.ipcRenderer.on('mt::update-file', (_, payload) => {
        const { type, change } = payload
        const { tabs } = this
        const { pathname } = change
        const tab = tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, pathname))
        if (tab) {
          const { id, isSaved, filename } = tab
          switch (type) {
            case 'unlink': {
              tab.isSaved = false
              this.pushTabNotification({
                tabId: id,
                msg: t('store.editor.fileRemovedOnDisk', { name: filename }),
                style: 'warn',
                showConfirm: false,
                exclusiveType: 'file_changed'
              })
              debouncedSendBufferedState()
              break
            }
            case 'add':
            case 'change': {
              const { autoSave } = preferencesStore
              if (autoSave) {
                if (autoSaveTimers.has(id)) {
                  const timer = autoSaveTimers.get(id)
                  if (timer) clearTimeout(timer)
                  autoSaveTimers.delete(id)
                }

                if (isSaved) {
                  this.loadChange(change as unknown as FileChangePayload)
                  return
                }
              }

              tab.isSaved = false
              this.pushTabNotification({
                tabId: id,
                msg: t('store.editor.fileChangedOnDisk', { name: filename }),
                showConfirm: true,
                exclusiveType: 'file_changed',
                action: (status) => {
                  if (status) {
                    this.loadChange(change as unknown as FileChangePayload)
                  }
                }
              })
              debouncedSendBufferedState()
              break
            }
            default:
              console.error(`LISTEN_FOR_FILE_CHANGE: Invalid type "${type}"`)
          }
        } else {
          console.error(`LISTEN_FOR_FILE_CHANGE: Cannot find tab for path "${pathname}".`)
        }
      })
    },

    ASK_FOR_IMAGE_PATH(): Promise<string[]> {
      return window.electron.ipcRenderer.invoke('mt::ask-for-image-path')
    },

    EDIT_ZOOM(zoomFactor: number): void {
      const preferencesStore = usePreferencesStore()
      zoomFactor = Number.parseFloat(zoomFactor.toFixed(3))
      const { zoom } = preferencesStore
      if (zoom !== zoomFactor) {
        preferencesStore.SET_SINGLE_PREFERENCE({ type: 'zoom', value: zoomFactor })
      }
      window.electron.webFrame.setZoomFactor(zoomFactor)
    },

    LISTEN_WINDOW_ZOOM(): void {
      window.electron.ipcRenderer.on('mt::window-zoom', (_, zoomFactor) => {
        this.EDIT_ZOOM(zoomFactor)
      })
      bus.on('mt::window-zoom', (zoomFactor) => {
        this.EDIT_ZOOM(zoomFactor as number)
      })
    },

    LISTEN_FOR_RELOAD_IMAGES(): void {
      window.electron.ipcRenderer.on('mt::invalidate-image-cache', () => {
        bus.emit('invalidate-image-cache')
      })
    },

    LISTEN_FOR_CONTEXT_MENU(): void {
      // 通用上下文菜单
      window.electron.ipcRenderer.on('mt::cm-copy-as-rich', () => {
        bus.emit('copyAsRich', 'copyAsRich')
      })
      window.electron.ipcRenderer.on('mt::cm-copy-as-html', () => {
        bus.emit('copyAsHtml', 'copyAsHtml')
      })
      window.electron.ipcRenderer.on('mt::cm-paste-as-plain-text', () => {
        bus.emit('pasteAsPlainText', 'pasteAsPlainText')
      })
      window.electron.ipcRenderer.on('mt::cm-insert-paragraph', (_, location) => {
        bus.emit('insertParagraph', location)
      })

      // 拼写检查
      window.electron.ipcRenderer.on('mt::spelling-replace-misspelling', (_, info) => {
        bus.emit('replace-misspelling', info)
      })
      window.electron.ipcRenderer.on('mt::spelling-show-switch-language', () => {
        bus.emit('open-command-spellchecker-switch-language')
      })
    },

    LISTEN_FOR_STATE_REPLACE(): void {
      window.electron.ipcRenderer.on('mt::load-state', (_, state) => {
        this.RESTORE_BUFFERED_STATE(state)
      })
    }
  }
})

// ----------------------------------------------------------------------------

/**
 * 返回已打开的根文件夹路径，无则空字符串
 *
 * @param projectStore project store 实例
 */
const getRootFolderFromState = (projectStore: ProjectStoreLike): string => {
  const openedFolder = projectStore.projectTree
  if (openedFolder) {
    return openedFolder.pathname ?? ''
  }
  return ''
}

/**
 * 按 `trimTrailingNewlineOption` 修剪末尾换行
 *
 * @param markdown 待修剪文本
 * @param trimTrailingNewlineOption 末尾换行处理方式
 */
const adjustTrailingNewlines = (
  markdown: string,
  trimTrailingNewlineOption: number
): string => {
  if (!markdown) {
    return ''
  }

  switch (trimTrailingNewlineOption) {
    // 修剪末尾换行
    case 0: {
      return trimTrailingNewlines(markdown)
    }
    // 保证单个末尾换行
    case 1: {
      // Muya 总会给 markdown 加末尾换行；若仅有一个换行则避免复制字符串
      const lastIndex = markdown.length - 1
      if (markdown[lastIndex] === '\n') {
        if (markdown.length === 1) {
          // 仅一个换行时返回空（再加末尾换行无意义）
          return ''
        } else if (markdown[lastIndex - 1] !== '\n') {
          return markdown
        }
      }

      // 否则先 trim 再加一个
      markdown = trimTrailingNewlines(markdown)
      if (markdown.length === 0) {
        // 空内容时不加末尾换行
        return ''
      }
      return markdown + '\n'
    }
    // 禁用，保持原文
    default:
      return markdown
  }
}

/**
 * 从 `text` 修剪末尾换行
 *
 * @param text 待修剪文本
 */
const trimTrailingNewlines = (text: string): string => {
  return text.replace(/[\r?\n]+$/, '')
}

interface ApplicationMenuState {
  isDisabled: boolean
  isMultiline: boolean
  isLooseListItem: boolean
  isTaskList: boolean
  isCodeFences: boolean
  isCodeContent: boolean
  isTable: boolean
  hasFrontMatter: boolean
  affiliation: Record<string, boolean>
}

/**
 * 构建应用菜单状态对象
 *
 * @param selection 选区信息
 * @returns 表示应用菜单状态的对象
 */
const createApplicationMenuState = ({
  start,
  end,
  affiliation,
  hasFrontMatter
}: SelectionChange): ApplicationMenuState => {
  const state: ApplicationMenuState = {
    isDisabled: false,
    // 是否选中多行
    isMultiline: start.key !== end.key,
    // 列表信息 —— 须选中列表
    isLooseListItem: false,
    isTaskList: false,
    // 选区是否为代码块类（math、html、code block）
    isCodeFences: false,
    // 是否选中代码块内一行
    isCodeContent: false,
    // 选区是否含表格
    isTable: false,
    hasFrontMatter: !!hasFrontMatter,
    // 选区类型键（string/boolean），如 "ul: true"
    affiliation: {}
  }
  const { isMultiline } = state
  const aff: AffiliationEntry[] = affiliation ?? []
  const startBlock: { text?: string; functionType?: string } = start.block ?? {}
  const endBlock: { functionType?: string } = end.block ?? {}

  // 从选区获取代码块信息
  if (
    (startBlock.functionType === 'cellContent' && endBlock.functionType === 'cellContent') ||
    (start.type === 'span' && startBlock.functionType === 'codeContent') ||
    (end.type === 'span' && endBlock.functionType === 'codeContent')
  ) {
    // 选中的是代码块类块（code、math 等）
    state.isCodeFences = true

    // 选中代码块内一行
    if (startBlock.functionType === 'codeContent' || endBlock.functionType === 'codeContent') {
      state.isCodeContent = true
    }
  }

  // 检查 affiliation 链上每一层列表 —— 嵌套列表会暴露全部层级
  // （如 ul 包 ol 则两者都勾选）。扫描完整链（非仅下方 depth-3 循环）
  // 以保证深层内层列表仍被勾选。loose/task 标志来自最内层列表（光标所在）；
  // 链为外→内顺序，故取最后一个 ul/ol 条目。
  const listEntries = aff.filter((b) => b.type === 'ul' || b.type === 'ol')
  for (const entry of listEntries) {
    // task 与 bullet 均为 `type: 'ul'`，用 listType 区分，以便 ol > task > ul 链各自勾选菜单
    const kind = entry.type === 'ol' ? 'ol' : entry.listType === 'task' ? 'task' : 'ul'
    state.affiliation[kind] = true
  }
  const innerList = listEntries[listEntries.length - 1]
  if (innerList) {
    // 引擎 affiliation 条目的 loose 标志在列表块本身（来自 `meta.loose`），非 children 链
    state.isLooseListItem = !!innerList.isLooseListItem
    state.isTaskList = innerList.listType === 'task'
  }

  // 在 block 深度 3 内搜索（如 "ul -> li -> p"，p 为列表项内实际段落）
  for (const b of aff.slice(0, 3)) {
    if (b.type === 'pre' && b.functionType) {
      if (/frontmatter|html|multiplemath|code$/.test(b.functionType)) {
        state.isCodeFences = true
        state.affiliation[b.functionType] = true
      }
      break
    } else if (b.type === 'figure' && b.functionType) {
      if (b.functionType === 'table') {
        state.isTable = true
        state.isDisabled = true
        state.affiliation[b.type] = true
      } else if (b.functionType === 'diagram') {
        // 图表为原子不可格式化块：整段禁用格式菜单，类似 code fence，但不是表格
        state.isCodeFences = true
        state.affiliation[b.functionType] = true
      }
      break
    } else if (isMultiline && /^h{1,6}$/.test(b.type)) {
      // 选中多个块元素
      state.affiliation = {}
      break
    } else if (b.type !== 'ul' && b.type !== 'ol') {
      // 列表已在上方处理（仅最内层）；深度受限扫描不得再添加外层列表类型
      if (!state.affiliation[b.type]) {
        state.affiliation[b.type] = true
      }
    }
  }

  // 清理
  if (Object.getOwnPropertyNames(state.affiliation).length >= 2 && state.affiliation.p) {
    delete state.affiliation.p
  }
  if ((state.affiliation.ul || state.affiliation.ol) && state.affiliation.li) {
    delete state.affiliation.li
  }
  return state
}

/**
 * 构建格式选区状态对象
 */
export const createSelectionFormatState = (
  formats: SelectionFormat[]
): Record<string, boolean> => {
  const state: Record<string, boolean> = {}
  for (const item of formats) {
    // underline/superscript/subscript/highlight 以 `html_tag` token 携带，
    // 真实格式键在 `tag`（u/sup/sub/mark），菜单 map 据此匹配 —— 裸 `type` 只会得到 `html_tag`
    const key = item.type === 'html_tag' ? (item.tag as string) : item.type
    if (key) state[key] = true
  }
  return state
}

/*
 * 通过 JSON 序列化/反序列化将 Pinia Proxy 转为可序列化值
 */
function toSerializableValue<T>(value: T | null | undefined, fallback: T): T
function toSerializableValue<T>(value: T | null | undefined, fallback: null): T | null
function toSerializableValue<T>(value: T | null | undefined, fallback: T | null = null): T | null {
  if (value == null) return fallback

  try {
    return deepClone(value) as T
  } catch (err) {
    console.warn('Unable to serialize editor buffer value:', err)
    return fallback
  }
}

interface BufferedTabState {
  id: string
  pathname: string
  filename: string
  markdown: string
  isSaved: boolean
  encoding: IFileState['encoding']
  lineEnding: IFileState['lineEnding']
  trimTrailingNewline: number
  adjustLineEndingOnSave: boolean
  cursor: unknown
  wordCount: IFileState['wordCount']
  muyaIndexCursor: unknown
  scrollTop: number
}

const createBufferedTabState = (tab: Partial<IFileState> & { id: string }): BufferedTabState => {
  return {
    id: tab.id,
    pathname: tab.pathname ?? defaultFileState.pathname,
    filename: tab.filename ?? defaultFileState.filename,
    markdown: typeof tab.markdown === 'string' ? tab.markdown : defaultFileState.markdown,
    isSaved: tab.isSaved ?? defaultFileState.isSaved,
    encoding: toSerializableValue(tab.encoding, defaultFileState.encoding),
    lineEnding: tab.lineEnding ?? defaultFileState.lineEnding,
    trimTrailingNewline:
      typeof tab.trimTrailingNewline === 'number'
        ? tab.trimTrailingNewline
        : defaultFileState.trimTrailingNewline,
    adjustLineEndingOnSave: tab.adjustLineEndingOnSave ?? defaultFileState.adjustLineEndingOnSave,
    cursor: toSerializableValue(tab.cursor, defaultFileState.cursor),
    wordCount: toSerializableValue(tab.wordCount, defaultFileState.wordCount),
    muyaIndexCursor: toSerializableValue(tab.muyaIndexCursor, defaultFileState.muyaIndexCursor),
    scrollTop: tab.scrollTop ?? defaultFileState.scrollTop
  }
}

interface BufferedRestoreWarning {
  tabId: string | null
  pathname: string
  msg: string
  showConfirm: boolean
  style: string
  exclusiveType: string
}

const createBufferedRestoreWarning = (
  warning: RestoreWarning | null | undefined
): BufferedRestoreWarning | null => {
  if (!warning) return null

  const { tabId, pathname, msg, showConfirm, style, exclusiveType } = warning
  if (!tabId && !pathname) return null
  if (!msg) return null

  return {
    tabId: tabId || null,
    pathname: pathname || '',
    msg,
    showConfirm: !!showConfirm,
    style: style || 'info',
    exclusiveType: exclusiveType || ''
  }
}

interface BufferedEditorState {
  currentFileId: string | null
  tabs: BufferedTabState[]
  restoreWarnings: BufferedRestoreWarning[]
}

const createBufferedEditorState = (state: unknown): BufferedEditorState | null => {
  const s = state as
    | {
      tabs?: unknown
      currentFileId?: string
      currentFile?: { id?: string } | null
      restoreWarnings?: unknown
    }
    | null
    | undefined
  if (!s || !Array.isArray(s.tabs)) {
    return null
  }

  return {
    currentFileId: s.currentFileId || s.currentFile?.id || null,
    tabs: (s.tabs as Array<Partial<IFileState> & { id: string }>).map(createBufferedTabState),
    restoreWarnings: Array.isArray(s.restoreWarnings)
      ? (s.restoreWarnings as RestoreWarning[])
        .map(createBufferedRestoreWarning)
        .filter((w): w is BufferedRestoreWarning => w !== null)
      : []
  }
}
