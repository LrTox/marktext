// 沙箱化 preload：仅可 require electron，process 仅暴露 platform/versions/env 等子集。
// 其余能力均在主进程，经 IPC 访问。
//
// 所有 IPC 经 @shared/types/ipc 的类型泛型转发，在调用处校验 channel 名、参数与返回值。

import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import pathe from 'pathe'

import type {
  IpcInvokeChannels,
  IpcSendChannels,
  IpcSyncChannels,
  IpcMainEventChannels,
  BootInfo
} from '@shared/types/ipc'

type RendererEventListener<K extends keyof IpcMainEventChannels> = (
  event: IpcRendererEvent,
  ...args: IpcMainEventChannels[K]
) => void

const invoke = <K extends keyof IpcInvokeChannels>(
  channel: K,
  ...args: IpcInvokeChannels[K]['args']
): Promise<IpcInvokeChannels[K]['ret']> => ipcRenderer.invoke(channel, ...args)

const send = <K extends keyof IpcSendChannels>(channel: K, ...args: IpcSendChannels[K]): void =>
  ipcRenderer.send(channel, ...args)

// 启动时一次同步握手，供渲染进程在 Vue computed 等场景读取 platform/env 而无需 await。
const bootInfo = ipcRenderer.sendSync('mt::boot-info') as BootInfo | undefined

const ipcWrapper = {
  send,
  sendSync: <K extends keyof IpcSyncChannels>(
    channel: K,
    ...args: IpcSyncChannels[K]['args']
  ): IpcSyncChannels[K]['ret'] => ipcRenderer.sendSync(channel, ...args),
  invoke,
  on: <K extends keyof IpcMainEventChannels>(
    channel: K,
    listener: RendererEventListener<K>
  ): (() => void) => {
    const subscription = (event: IpcRendererEvent, ...args: unknown[]): void => {
      listener(event, ...(args as IpcMainEventChannels[K]))
    }
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  once: <K extends keyof IpcMainEventChannels>(
    channel: K,
    listener: RendererEventListener<K>
  ): (() => void) => {
    const subscription = (event: IpcRendererEvent, ...args: unknown[]): void => {
      listener(event, ...(args as IpcMainEventChannels[K]))
    }
    ipcRenderer.once(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  removeAllListeners: (channel: keyof IpcMainEventChannels | string): void => {
    ipcRenderer.removeAllListeners(channel as string)
  }
}

const shellAPI = {
  openExternal: (url: string) => invoke('mt::shell::open-external', url),
  showItemInFolder: (fullPath: string) => send('mt::shell::show-item', fullPath),
  openPath: (fullPath: string) => invoke('mt::shell::open-path', fullPath)
}

const clipboardAPI = {
  writeText: (text: string) => send('mt::clipboard::write-text', text),
  writeImage: (src: string) => invoke('mt::clipboard::write-image', src),
  readText: () => invoke('mt::clipboard::read-text'),
  guessFilePath: () => invoke('mt::clipboard::guess-file-path')
}

const webFrameAPI = {
  setZoomFactor: (factor: number): void => {
    if (typeof factor === 'number' && factor > 0) webFrame.setZoomFactor(factor)
  },
  setZoomLevel: (level: number): void => {
    if (typeof level === 'number') webFrame.setZoomLevel(level)
  }
}

const webUtilsAPI = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

const windowControlAPI = {
  minimize: () => send('mt::win::minimize'),
  maximize: () => send('mt::win::maximize'),
  unmaximize: () => send('mt::win::unmaximize'),
  toggleMaximize: () => send('mt::win::toggle-maximize'),
  close: () => send('mt::win::close'),
  setFullScreen: (flag: boolean) => send('mt::win::set-fullscreen', flag),
  toggleFullScreen: () => send('mt::win::toggle-fullscreen'),
  isMaximized: () => invoke('mt::win::is-maximized'),
  isFullScreen: () => invoke('mt::win::is-fullscreen'),
  popupMenu: (template: unknown, position?: { x: number; y: number }) =>
    send('mt::menu::popup', template as never, position),
  popupApplicationMenu: (position?: { x: number; y: number }) =>
    send('mt::menu::popup-application', position)
}

// 以下三个谓词为纯路径字符串运算：放在 preload 中保持同步，
// 使 tabs.find(t => isSamePathSync(...)) 等调用仍返回布尔值而非 Promise。
const MARKDOWN_EXTENSIONS = [
  'markdown',
  'mdown',
  'mkdn',
  'md',
  'mkd',
  'mdwn',
  'mdtxt',
  'mdtext',
  'mdx',
  'text',
  'txt'
] as const

const hasMarkdownExtension = (filename: string): boolean => {
  if (!filename || typeof filename !== 'string') return false
  return MARKDOWN_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
}

const isChildOfDirectory = (dir: string, child: string): boolean => {
  if (!dir || !child) return false
  const relative = pathe.relative(dir, child)
  return !!relative && !relative.startsWith('..') && !pathe.isAbsolute(relative)
}

const isSamePathSync = (pathA: string, pathB: string, isNormalized: boolean = false): boolean => {
  if (!pathA || !pathB) return false
  const a = isNormalized ? pathA : pathe.normalize(pathA)
  const b = isNormalized ? pathB : pathe.normalize(pathB)
  if (a.length !== b.length) return false
  if (a === b) return true
  if (a.toLowerCase() === b.toLowerCase()) {
    // 大小写不敏感文件系统回退 — 标签匹配等调用方需要立即得到布尔结果，故短暂阻塞于同步 IPC。
    try {
      return ipcRenderer.sendSync('mt::paths::is-same-sync', a, b)
    } catch {
      return false
    }
  }
  return false
}

const fileUtilsAPI = {
  isFile: (p: string) => invoke('mt::fs::is-file', p),
  isDirectory: (p: string) => invoke('mt::fs::is-directory', p),
  emptyDir: (p: string) => invoke('mt::fs::empty-dir', p),
  copy: (src: string, dest: string) => invoke('mt::fs::copy', src, dest),
  ensureDir: (p: string) => invoke('mt::fs::ensure-dir', p),
  outputFile: (p: string, data: string | Uint8Array) => invoke('mt::fs::output-file', p, data),
  move: (src: string, dest: string) => invoke('mt::fs::move', src, dest),
  stat: (p: string) => invoke('mt::fs::stat', p),
  writeFile: (p: string, data: string | Uint8Array) => invoke('mt::fs::write-file', p, data),
  readFile: (p: string, encoding?: string) => invoke('mt::fs::read-file', p, encoding),
  pathExists: (p: string) => invoke('mt::fs::path-exists', p),
  unlink: (p: string) => invoke('mt::fs::unlink', p),
  readdir: (p: string) => invoke('mt::fs::readdir', p),
  saveImageAs: (src: string, filename?: string) => invoke('mt::fs::save-image-as', src, filename),
  isExecutable: (p: string) => invoke('mt::fs::is-executable', p),
  // 纯字符串谓词 — 常见情况同步，无需 IPC。
  isChildOfDirectory,
  hasMarkdownExtension,
  isSamePathSync,
  // isImageFile 需 fs.statSync，经 IPC 异步实现。
  isImageFile: (p: string) => invoke('mt::paths::is-image', p),
  MARKDOWN_INCLUSIONS: bootInfo?.MARKDOWN_INCLUSIONS || []
}

const commandAPI = {
  exists: (name: string) => invoke('mt::cmd::exists', name)
}

const i18nAPI = {
  loadTranslations: (language: string) => invoke('mt::i18n::load', language)
}

type RipgrepHandler = (payload: unknown) => void
const ripgrepAPI = {
  start: (req: unknown) => invoke('mt::rg::start', req),
  cancel: (searchId: string) => send('mt::rg::cancel', searchId),
  onMatch: (handler: RipgrepHandler) => {
    const sub = (_e: IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on('mt::rg::match', sub)
    return () => ipcRenderer.removeListener('mt::rg::match', sub)
  },
  onProgress: (handler: RipgrepHandler) => {
    const sub = (_e: IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on('mt::rg::progress', sub)
    return () => ipcRenderer.removeListener('mt::rg::progress', sub)
  },
  onDone: (handler: RipgrepHandler) => {
    const sub = (_e: IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on('mt::rg::done', sub)
    return () => ipcRenderer.removeListener('mt::rg::done', sub)
  },
  onError: (handler: RipgrepHandler) => {
    const sub = (_e: IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on('mt::rg::error', sub)
    return () => ipcRenderer.removeListener('mt::rg::error', sub)
  },
  onCancelled: (handler: RipgrepHandler) => {
    const sub = (_e: IpcRendererEvent, payload: unknown) => handler(payload)
    ipcRenderer.on('mt::rg::cancelled', sub)
    return () => ipcRenderer.removeListener('mt::rg::cancelled', sub)
  }
}

const uploaderAPI = {
  uploadImage: (req: unknown) => invoke('mt::uploader::upload', req)
}

const fontsAPI = {
  list: () => invoke('mt::fonts::list')
}

const electronAPI = {
  ipcRenderer: ipcWrapper,
  shell: shellAPI,
  clipboard: clipboardAPI,
  webFrame: webFrameAPI,
  webUtils: webUtilsAPI,
  process: {
    platform: bootInfo?.platform || process.platform,
    arch: bootInfo?.arch,
    versions: bootInfo?.versions || {},
    env: bootInfo?.env || {},
    resourcesPath: bootInfo?.paths?.resources,
    cwd: bootInfo?.paths?.cwd
  },
  paths: bootInfo?.paths || {},
  isUpdatable: !!bootInfo?.isUpdatable,
  windowControl: windowControlAPI
}

// 向渲染进程暴露 Node path 兼容 API。pathe 为跨平台实现，统一使用 / 分隔符，可在沙箱渲染进程中使用。
const pathAPI = {
  basename: (...args: Parameters<typeof pathe.basename>) => pathe.basename(...args),
  dirname: (...args: Parameters<typeof pathe.dirname>) => pathe.dirname(...args),
  extname: (...args: Parameters<typeof pathe.extname>) => pathe.extname(...args),
  join: (...args: string[]) => pathe.join(...args),
  resolve: (...args: string[]) => pathe.resolve(...args),
  relative: (...args: Parameters<typeof pathe.relative>) => pathe.relative(...args),
  isAbsolute: (...args: Parameters<typeof pathe.isAbsolute>) => pathe.isAbsolute(...args),
  normalize: (...args: Parameters<typeof pathe.normalize>) => pathe.normalize(...args),
  parse: (...args: Parameters<typeof pathe.parse>) => pathe.parse(...args),
  format: (...args: Parameters<typeof pathe.format>) => pathe.format(...args),
  sep: pathe.sep,
  delimiter: pathe.delimiter
  // 注：pathe.posix / pathe.win32 有意不暴露。
  // 二者含自引用，会破坏 contextBridge.exposeInMainWorld 的结构化克隆。
  // 本仓库无代码读取 window.path.posix / window.path.win32。
}

// 部分第三方包在模块加载时读取 process.platform（如 @hfelix/electron-localshortcut）。
// 暴露最小 browser-safe process 全局，避免 Vue 挂载前 import 抛错。
const processShim = {
  platform: bootInfo?.platform || process.platform,
  arch: bootInfo?.arch,
  versions: bootInfo?.versions || {},
  env: bootInfo?.env || {},
  resourcesPath: bootInfo?.paths?.resources,
  cwd: () => bootInfo?.paths?.cwd,
  // 部分库调用 process.nextTick；映射到微任务队列。
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    Promise.resolve().then(() => fn(...args))
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('process', processShim)
  contextBridge.exposeInMainWorld('rgPath', bootInfo?.paths?.ripgrepBinary || '')
  contextBridge.exposeInMainWorld('fileUtils', fileUtilsAPI)
  contextBridge.exposeInMainWorld('path', pathAPI)
  contextBridge.exposeInMainWorld('commandExists', commandAPI)
  contextBridge.exposeInMainWorld('i18nUtils', i18nAPI)
  contextBridge.exposeInMainWorld('ripgrep', ripgrepAPI)
  contextBridge.exposeInMainWorld('uploader', uploaderAPI)
  contextBridge.exposeInMainWorld('fonts', fontsAPI)
} catch (error) {
  console.error(error)
}
