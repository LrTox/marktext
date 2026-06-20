/** 应用启动全局配置：__static 路径、可选 GPU 禁用等。 */
import path from 'path'
import { app } from 'electron'

if (process.env.MARKTEXT_DEV_DISABLE_GPU) {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('no-sandbox')
}

// 根据环境设置 __static 指向生产/开发下的 static 目录
;(global as unknown as { __static: string }).__static = path
  .join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'static')
  .replace(/\\/g, '\\\\')
