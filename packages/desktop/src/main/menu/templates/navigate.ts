import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as editActions from '../actions/edit'
import * as viewActions from '../actions/view'
import { COMMANDS } from '../../commands'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  return {
    label: t('menu.navigate.navigate'),
    submenu: [
      {
        label: t('menu.view.commandPalette'),
        accelerator: keybindings.getAccelerator('view.command-palette') ?? undefined,
        click(_menuItem, focusedWindow) {
          viewActions.showCommandPalette(focusedWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        label: t('menu.edit.find'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND) ?? undefined,
        click(_menuItem, browserWindow) {
          editActions.editorFind(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        label: t('menu.edit.findNext'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND_NEXT) ?? undefined,
        click(_menuItem, browserWindow) {
          editActions.editorFindNext(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        label: t('menu.edit.findPrevious'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND_PREVIOUS) ?? undefined,
        click(_menuItem, browserWindow) {
          editActions.editorFindPrevious(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        label: t('menu.edit.replace'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_REPLACE) ?? undefined,
        click(_menuItem, browserWindow) {
          editActions.editorReplace(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        label: t('menu.edit.findInFolder'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND_IN_FOLDER) ?? undefined,
        click(_menuItem, browserWindow) {
          editActions.findInFolder(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        label: t('menu.view.toggleTableOfContents'),
        id: 'tocMenuItem',
        accelerator: keybindings.getAccelerator('view.toggle-toc') ?? undefined,
        click(_menuItem, focusedWindow) {
          viewActions.showTableOfContents(focusedWindow as BrowserWindow | undefined)
        }
      }
    ]
  }
}
