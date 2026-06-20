#!/usr/bin/env node
/**
 * 跨平台 postinstall：为 native-keymap 打 C++20 补丁、下载 Electron、
 * 按 Electron ABI 重建原生模块、生成 locale 文件。
 *
 * native-keymap 列为 optionalDependency，pnpm 在 Node v24+ 上会忽略其 gyp 编译失败。
 * 本脚本恢复源码、打补丁并通过 @electron/rebuild 正确重建。
 *
 * 步骤顺序重要：须在下载 Electron 前恢复 native-keymap 源码，
 * 因内部 pnpm add 可能扰动 devDependency 状态。
 *
 * Monorepo 布局：Electron 桌面应用在 packages/desktop，
 * 自有 node_modules（workspace 本地依赖不提升到根 — shamefully-hoist=true 仅扁平化传递依赖）。
 * 所有 Electron 相关查找（binary、install.js、native-keymap、electron-rebuild、patch-package）
 * 因此解析到 packages/desktop/node_modules。patch-package 与 electron-rebuild
 * 也以 cwd=packages/desktop 运行，以正确加载 patches/ 与本地 package.json。
 */

import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const repoRoot = path.join(__dirname, '..')
const desktopRoot = path.join(repoRoot, 'packages', 'desktop')
/** 默认 npmmirror；可被 ELECTRON_MIRROR 或 .npmrc 的 electron_mirror 覆盖 */
const electronMirror =
  process.env.ELECTRON_MIRROR ||
  process.env.npm_config_electron_mirror ||
  'https://npmmirror.com/mirrors/electron/'
const windowsVCToolsVersion =
  process.platform === 'win32' &&
  fs.existsSync(
    'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Tools\\MSVC\\14.44.35207'
  )
    ? '14.44.35207'
    : undefined

function run(cmd: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const { cwd = repoRoot, env = {} } = opts
  execSync(cmd, { stdio: 'inherit', cwd, env: { ...process.env, ...env } })
}

// 检测触发 postinstall 的包管理器，使 pnpm（主）与 npm（回退）均可工作
const userAgent = process.env.npm_config_user_agent || ''
const isPnpm = userAgent.startsWith('pnpm')
// patch-package 与 electron-rebuild 为本地安装；直接调用 node_modules/.bin（由 shamefully-hoist 提升）
const ext = process.platform === 'win32' ? '.cmd' : ''
const patchPackageBin = path.join(desktopRoot, 'node_modules', '.bin', `patch-package${ext}`)
const electronRebuildBin = path.join(desktopRoot, 'node_modules', '.bin', `electron-rebuild${ext}`)

// ── 1. 确保 native-keymap 源码存在（pnpm 在 optional 失败时会移除） ──
const nativeKeymapDir = path.join(desktopRoot, 'node_modules', 'native-keymap')
if (!fs.existsSync(nativeKeymapDir)) {
  console.log('Installing native-keymap source (skipping compilation)...')
  // native-keymap 已在 marktext optionalDependencies 中；add 会重装且不改变版本范围
  if (isPnpm) {
    run('pnpm --filter marktext add native-keymap --ignore-scripts')
  } else {
    run('npm install native-keymap --ignore-scripts --no-save', { cwd: desktopRoot })
  }
}

// ── 2. 下载并解压 Electron 二进制 ────────────────────────────────────
const electronInstall = path.join(desktopRoot, 'node_modules', 'electron', 'install.js')

if (!fs.existsSync(electronInstall)) {
  console.error('electron/install.js not found — skipping Electron download')
} else {
  const plat =
    process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || os.platform()
  const platformBinary =
    plat === 'win32'
      ? 'electron.exe'
      : plat === 'darwin' || plat === 'mas'
        ? 'Electron.app/Contents/MacOS/Electron'
        : 'electron'

  const pathTxt = path.join(desktopRoot, 'node_modules', 'electron', 'path.txt')
  const distDir = path.join(desktopRoot, 'node_modules', 'electron', 'dist')

  // macOS 还需 Frameworks/ — yauzl v2.10.0 在 Node v26+ 会挂起，且可能静默产生不含 Frameworks 的不完整 dist/
  const isComplete = () => {
    if (!fs.existsSync(pathTxt)) return false
    const rel = fs.readFileSync(pathTxt, 'utf8').trim()
    if (!fs.existsSync(path.join(desktopRoot, 'node_modules', 'electron', rel))) return false
    if (plat === 'darwin' || plat === 'mas') {
      return fs.existsSync(path.join(distDir, 'Electron.app', 'Contents', 'Frameworks'))
    }
    return true
  }

  if (!isComplete()) {
    // 删除不完整 dist，确保 install.js 重新解压
    if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true })
    if (fs.existsSync(pathTxt)) fs.unlinkSync(pathTxt)

    console.log(`Downloading Electron binary (mirror: ${electronMirror})...`)
    try {
      run(`node "${electronInstall}"`, { env: { ELECTRON_MIRROR: electronMirror } })
    } catch {
      console.log('Mirror download failed, retrying official GitHub releases...')
      const env = { ...process.env }
      delete env.ELECTRON_MIRROR
      delete env.npm_config_electron_mirror
      run(`node "${electronInstall}"`, { env })
    }

    const electronExe = path.join(distDir, platformBinary)
    if (!fs.existsSync(electronExe)) {
      const electronPkgPath = path.join(desktopRoot, 'node_modules', 'electron', 'package.json')
      const { version } = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')) as { version: string }
      const arch = process.env.npm_config_arch || os.arch()
      const zipName =
        plat === 'win32'
          ? `electron-v${version}-win32-${arch === 'ia32' ? 'ia32' : 'x64'}.zip`
          : plat === 'darwin' || plat === 'mas'
            ? `electron-v${version}-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
            : `electron-v${version}-linux-${arch}.zip`
      const cacheRoot =
        process.env.electron_config_cache ||
        (process.platform === 'win32'
          ? path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')
          : path.join(os.homedir(), '.cache', 'electron'))

      let zipPath = ''
      if (process.platform === 'win32') {
        const matches: string[] = []
        const walk = (dir: string) => {
          if (!fs.existsSync(dir)) return
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.name === zipName) matches.push(full)
          }
        }
        walk(cacheRoot)
        zipPath = matches[0] || ''
      } else {
        try {
          zipPath = execSync(`find "${cacheRoot}" -name "${zipName}" 2>/dev/null | head -1`)
            .toString()
            .trim()
        } catch {
          /* 忽略 */
        }
      }

      if (!zipPath) {
        throw new Error(
          'Electron zip not in cache after download. ' +
            'Try: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install'
        )
      }

      console.log(`Re-extracting Electron with system tools (${zipName})...`)
      if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true })
      fs.mkdirSync(distDir, { recursive: true })
      if (process.platform === 'win32') {
        run(
          `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force"`
        )
      } else {
        run(`unzip -q "${zipPath}" -d "${distDir}"`)
      }
      fs.writeFileSync(pathTxt, platformBinary)
      fs.writeFileSync(path.join(distDir, 'version'), version)
    }

    // yauzl v2.10.0 + Node v26+：openReadStream 回调对压缩项永不触发
    // → extract-zip 静默退出且 dist/ 不完整。用系统 unzip 重新解压。
    if (
      (plat === 'darwin' || plat === 'mas') &&
      !fs.existsSync(path.join(distDir, 'Electron.app', 'Contents', 'Frameworks'))
    ) {
      const electronPkgPath = path.join(desktopRoot, 'node_modules', 'electron', 'package.json')
      const { version } = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')) as { version: string }
      const arch = process.env.npm_config_arch || os.arch()
      const zipName = `electron-v${version}-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
      const cacheRoot =
        process.env.electron_config_cache ||
        path.join(os.homedir(), 'Library', 'Caches', 'electron')

      let zipPath = ''
      try {
        zipPath = execSync(`find "${cacheRoot}" -name "${zipName}" 2>/dev/null | head -1`)
          .toString()
          .trim()
      } catch {
        /* 忽略 */
      }

      if (!zipPath) {
        throw new Error(
          'Electron zip not in cache after download. ' +
            'Try: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install'
        )
      }

      console.log(
        `Re-extracting with system unzip (yauzl incompatible with Node ${process.version})...`
      )
      if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true })
      run(`unzip -q "${zipPath}" -d "${distDir}"`)
      fs.writeFileSync(pathTxt, platformBinary)
      fs.writeFileSync(path.join(distDir, 'version'), version)
    }

    // 确保 path.txt 存在（install.js 在缓存命中时可能跳过）
    if (!fs.existsSync(pathTxt)) {
      fs.writeFileSync(pathTxt, platformBinary)
    }
  }
}

// ── 3. 对 native-keymap 应用 C++20 补丁（patches/ 位于 packages/desktop） ──
console.log('Applying patches...')
run(`"${patchPackageBin}"`, { cwd: desktopRoot })

// ── 4. 按 Electron ABI 重建原生模块 ──────────────────────────────────────
console.log('Rebuilding native modules for Electron...')
run(`"${electronRebuildBin}" -f`, {
  cwd: desktopRoot,
  env: windowsVCToolsVersion ? { VCToolsVersion: windowsVCToolsVersion } : {}
})

// ── 5. 生成压缩后的 locale 文件 ───────────────────────────────────────
console.log('Minifying locales...')
run('pnpm tsx scripts/minify-locales.ts')
