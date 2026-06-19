import path from 'path'
import { app } from 'electron'

if (process.env.MARKTEXT_DEV_DISABLE_GPU) {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('no-sandbox')
}

// Set `__static` path to static files in production / development depending on the environment
;(global as unknown as { __static: string }).__static = path
  .join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'static')
  .replace(/\\/g, '\\\\')
