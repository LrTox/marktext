import { type MenuItemConstructorOptions } from 'electron'
import edit from './edit'
import prefEdit from './prefEdit'
import file from './file'
import help from './help'
import marktext from './marktext'
import code from './code'
import navigate from './navigate'
import tools from './tools'
import view from './view'
import window from './window'
import type Keybindings from '../../keyboard/shortcutHandler'
import type Preference from '../../preferences'

export { default as dockMenu } from './dock'

/**
 * 创建设置窗口菜单。
 *
 * @param keybindings 快捷键实例
 */
export const configSettingMenu = (keybindings: Keybindings): MenuItemConstructorOptions[] => {
  return [
    ...(process.platform === 'darwin' ? [marktext(keybindings)] : []),
    prefEdit(keybindings),
    help()
  ]
}

/**
 * 创建编辑器窗口的应用菜单。
 *
 * @param keybindings 快捷键实例
 * @param preferences 偏好设置实例
 * @param recentlyUsedFiles 最近打开的文件列表
 */
export default function(
  keybindings: Keybindings,
  preferences: Preference,
  recentlyUsedFiles: string[] = []
): MenuItemConstructorOptions[] {
  return [
    ...(process.platform === 'darwin' ? [marktext(keybindings)] : []),
    file(keybindings, preferences, recentlyUsedFiles),
    edit(keybindings),
    view(keybindings),
    navigate(keybindings),
    code(keybindings),
    tools(keybindings, preferences),
    window(keybindings),
    help()
  ]
}
