import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as editActions from '../actions/edit'
import * as fileActions from '../actions/file'
import * as viewActions from '../actions/view'
import theme from './theme'
import { COMMANDS } from '../../commands'
import { isOsx } from '../../config'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'
import type Preference from '../../preferences'

export default function(
  keybindings: Keybindings,
  preferences: Preference
): MenuItemConstructorOptions {
  return {
    label: t('menu.tools.tools'),
    submenu: [
      {
        label: t('menu.file.import'),
        click(_menuItem, browserWindow) {
          fileActions.importFile((browserWindow as BrowserWindow | undefined) ?? null)
        }
      },
      {
        label: t('menu.file.export'),
        submenu: [
          {
            label: t('menu.file.exportHtml'),
            click(_menuItem, browserWindow) {
              fileActions.exportFile(browserWindow as BrowserWindow | undefined, 'styledHtml')
            }
          },
          {
            label: t('menu.file.exportPdf'),
            accelerator: keybindings.getAccelerator('file.export-file.pdf') ?? undefined,
            click(_menuItem, browserWindow) {
              fileActions.exportFile(browserWindow as BrowserWindow | undefined, 'pdf')
            }
          }
        ]
      },
      {
        label: t('menu.file.print'),
        accelerator: keybindings.getAccelerator('file.print') ?? undefined,
        click(_menuItem, browserWindow) {
          fileActions.printDocument(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        label: t('menu.edit.screenshot'),
        id: 'screenshot',
        visible: isOsx,
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_SCREENSHOT) ?? undefined,
        click(_menuItem, browserWindow) {
          editActions.screenshot(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        label: t('menu.view.reloadImages'),
        accelerator: keybindings.getAccelerator('view.reload-images') ?? undefined,
        click(_menuItem, focusedWindow) {
          viewActions.reloadImageCache(focusedWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      theme(preferences)
    ]
  }
}
