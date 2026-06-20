import path from 'path'
import { app } from 'electron'
import os from 'os'
import { isDirectory } from 'common/filesystem'
import parseArgs, { type ParsedArgs } from './parser'
import { getPath } from '../utils'

const write = (s: string): boolean => process.stdout.write(s)
const writeLine = (s: string): boolean => write(s + '\n')

const cli = (): ParsedArgs => {
  let argv = process.argv.slice(1)
  if (process.env.NODE_ENV === 'development') {
    // 不向 MarkText 传递 Electron 开发参数，并修改 user data 路径
    argv = [
      '--user-data-dir',
      process.env.MARKTEXT_DEV_USER_DATA_DIR || path.join(getPath('appData'), 'marktext-dev')
    ]
    if (process.env.MARKTEXT_DEV_DISABLE_GPU) {
      argv.push('--disable-gpu')
    }
  }

  const args = parseArgs(argv, true)
  if (args['--help']) {
    write(`Usage: marktext [commands] [path ...]

  Available commands:

        --debug                   Enable debug mode
        --safe                    Disable plugins and other user configuration
    -n, --new-window              Open a new window on second-instance
        --user-data-dir           Change the user data directory
        --disable-gpu             Disable GPU hardware acceleration
        --disable-spellcheck      Disable built-in spellchecker
    -v, --verbose                 Be verbose
        --version                 Print version information
    -h, --help                    Print this help message
`)
    process.exit(0)
  }

  if (args['--version']) {
    writeLine(`MarkText: ${MARKTEXT_VERSION_STRING}`)
    writeLine(`Node.js: ${process.versions.node}`)
    writeLine(`Electron: ${process.versions.electron}`)
    writeLine(`Chromium: ${process.versions.chrome}`)
    writeLine(`OS: ${os.type()} ${os.arch()} ${os.release()}`)
    process.exit(0)
  }

  // 检测便携模式并确保 user data 路径为绝对路径；不可写时会导致应用崩溃
  if (!args['--user-data-dir']) {
    const portablePath = path.join(app.getAppPath(), '..', '..', 'marktext-user-data')
    if (isDirectory(portablePath)) {
      args['--user-data-dir'] = portablePath
    }
  } else {
    args['--user-data-dir'] = path.resolve(args['--user-data-dir'])
  }

  return args
}

export default cli
