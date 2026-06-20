/**
 * 主进程 IPC：文件系统操作（读写、stat、图片另存为等）。
 * 对应契约见 `@shared/types/ipc.ts` 中 `mt::fs::*` invoke 通道。
 */
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { statSync, constants, type Stats } from 'fs'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isFile as commonIsFile, isDirectory as commonIsDirectory } from 'common/filesystem'

interface SerializedStat {
  size: number
  mtimeMs: number
  ctimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

const serializeStat = (stats: Stats): SerializedStat => ({
  size: stats.size,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  isFile: stats.isFile(),
  isDirectory: stats.isDirectory(),
  isSymbolicLink: stats.isSymbolicLink()
})

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: string }).type === 'Buffer' &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data)
  }
  return data
}

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
  { name: 'All Files', extensions: ['*'] }
]

const IMAGE_CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp'
}

const sanitizeFilename = (filename?: string): string => {
  const trimmed = filename?.trim() || 'image'
  const basename = path.basename(trimmed).replace(
    // eslint-disable-next-line no-control-regex -- 清理文件名中的非法控制字符
    /[<>:"/\\|?*\u0000-\u001f]/g,
    '_'
  )
  return basename || 'image'
}

const extensionFromDataUrl = (src: string): string => {
  const contentType = src.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
  return contentType ? IMAGE_CONTENT_TYPE_EXTENSIONS[contentType] || '' : ''
}

const ensureExtension = (filename: string, src: string, contentType?: string): string => {
  if (path.extname(filename)) return filename

  const urlExt = /^file:\/\//i.test(src)
    ? path.extname(fileURLToPath(src))
    : path.extname(src.split(/[?#]/)[0] || '')
  const ext = urlExt || extensionFromDataUrl(src) || (contentType ? IMAGE_CONTENT_TYPE_EXTENSIONS[contentType] : '') || '.png'
  return `${filename}${ext}`
}

const pathFromFileUrl = (src: string): string => {
  try {
    return fileURLToPath(src)
  } catch {
    return decodeURIComponent(src.replace(/^file:\/\//i, ''))
  }
}

export const imageBufferFromSource = async(
  src: string
): Promise<{ buffer: Buffer; contentType?: string }> => {
  if (/^file:\/\//i.test(src)) {
    return { buffer: await fs.readFile(pathFromFileUrl(src)) }
  }

  const dataUrlMatch = src.match(/^data:([^;,]+)?((?:;[^,]+)*),(.*)$/i)
  if (dataUrlMatch) {
    const [, contentType, options, data] = dataUrlMatch
    return {
      buffer: Buffer.from(decodeURIComponent(data), options.includes(';base64') ? 'base64' : 'utf8'),
      contentType: contentType?.toLowerCase()
    }
  }

  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src)
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}`)
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type')?.split(';')[0]?.toLowerCase()
    }
  }

  return { buffer: await fs.readFile(src) }
}

export const registerFsHandlers = (): void => {
  ipcMain.handle('mt::fs::is-file', (_e, p: string) => commonIsFile(p))
  ipcMain.handle('mt::fs::is-directory', (_e, p: string) => commonIsDirectory(p))
  ipcMain.handle('mt::fs::empty-dir', (_e, p: string) => fs.emptyDir(p))
  ipcMain.handle('mt::fs::copy', (_e, src: string, dest: string) => fs.copy(src, dest))
  ipcMain.handle('mt::fs::ensure-dir', (_e, p: string) => fs.ensureDir(p))

  ipcMain.handle('mt::fs::output-file', (_e, p: string, data: unknown) =>
    fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  )
  ipcMain.handle('mt::fs::move', (_e, src: string, dest: string) =>
    fs.move(src, dest, { overwrite: false })
  )
  ipcMain.handle('mt::fs::stat', async(_e, p: string) => serializeStat(await fs.stat(p)))

  ipcMain.handle('mt::fs::write-file', (_e, p: string, data: unknown) =>
    fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  )
  ipcMain.handle('mt::fs::read-file', async(_e, p: string, encoding?: BufferEncoding) => {
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  ipcMain.handle('mt::fs::save-image-as', async(e, src: string, filename?: string) => {
    const { buffer, contentType } = await imageBufferFromSource(src)
    const win = BrowserWindow.fromWebContents(e.sender)
    const defaultPath = ensureExtension(sanitizeFilename(filename), src, contentType)
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, {
        defaultPath,
        filters: IMAGE_FILTERS
      })
      : await dialog.showSaveDialog({
        defaultPath,
        filters: IMAGE_FILTERS
      })

    if (canceled || !filePath) return { canceled: true }

    await fs.writeFile(filePath, buffer)
    return { canceled: false, filePath }
  })
  ipcMain.handle('mt::fs::path-exists', (_e, p: string) => fs.pathExists(p))
  ipcMain.handle('mt::fs::unlink', (_e, p: string) => fs.unlink(p))
  ipcMain.handle('mt::fs::readdir', (_e, p: string) => fs.readdir(p))
  ipcMain.handle('mt::fs::is-executable', (_e, p: string) => {
    try {
      const stat = statSync(p)
      if (process.platform === 'win32') return stat.isFile()
      return (
        stat.isFile() &&
        (stat.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH)) !== 0
      )
    } catch {
      return false
    }
  })
}
