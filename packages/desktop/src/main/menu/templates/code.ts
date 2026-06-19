import { type MenuItemConstructorOptions } from 'electron'
import format from './format'
import paragraph from './paragraph'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  return {
    label: t('menu.code.code'),
    submenu: [paragraph(keybindings), format(keybindings)]
  }
}
