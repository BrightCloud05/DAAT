/**
 * vault-ipc.ts
 *
 * The vault subsystem's single seam into main.ts: `initVaultIpc()` registers
 * every `hermes:vault:*` handler and returns the service so backend-env can
 * ask for VAULT_PATH / VAULT_INDEX_DB (M3). Renderer-facing surface mirrors
 * `window.hermesDesktop.vault.*` in preload.ts.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'

import { VaultService, defaultICloudVaultDir, defaultLocalVaultDir } from './vault-service'
import type { VaultConflictEvent, VaultIndexEvent } from './vault-types'

function broadcast(channel: string, payload: VaultIndexEvent | VaultConflictEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function initVaultIpc(): VaultService {
  const service = new VaultService({
    onIndexEvent: event => broadcast('hermes:vault:index-event', event),
    onConflict: event => broadcast('hermes:vault:conflict', event)
  })

  void service.restore()

  ipcMain.handle('hermes:vault:info', () => service.info())

  ipcMain.handle('hermes:vault:defaults', () => ({
    icloud: defaultICloudVaultDir(),
    local: defaultLocalVaultDir()
  }))

  ipcMain.handle('hermes:vault:create', (_event, baseDir?: string) => service.create(baseDir))

  ipcMain.handle('hermes:vault:choose', async event => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(window as BrowserWindow, {
      title: 'Open vault folder',
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths.length) {
      return null
    }

    return service.open(result.filePaths[0])
  })

  ipcMain.handle('hermes:vault:open', (_event, root: string) => service.open(root))
  ipcMain.handle('hermes:vault:reindex', () => service.reindex())
  ipcMain.handle('hermes:vault:list', () => service.list())
  ipcMain.handle('hermes:vault:listDir', (_event, subdir?: string) => service.listDir(subdir))
  ipcMain.handle('hermes:vault:read', (_event, relPath: string) => service.read(relPath))

  ipcMain.handle(
    'hermes:vault:write',
    (_event, relPath: string, content: string, expectedMtimeMs: number | null) =>
      service.write(relPath, content, expectedMtimeMs ?? null)
  )

  ipcMain.handle('hermes:vault:createNote', (_event, relPath: string) => service.createNote(relPath))
  ipcMain.handle('hermes:vault:createDir', (_event, relPath: string) => service.createDir(relPath))
  ipcMain.handle('hermes:vault:rename', (_event, fromRel: string, toRel: string) => service.rename(fromRel, toRel))
  ipcMain.handle('hermes:vault:trash', (_event, relPath: string) => service.trash(relPath))
  ipcMain.handle('hermes:vault:search', (_event, query: string) => service.search(query))
  ipcMain.handle('hermes:vault:backlinks', (_event, relPath: string) => service.backlinks(relPath))
  ipcMain.handle('hermes:vault:linksFrom', (_event, relPath: string) => service.linksFrom(relPath))
  ipcMain.handle('hermes:vault:resolveWikilink', (_event, targetRaw: string) => service.resolveWikilink(targetRaw))
  ipcMain.handle('hermes:vault:noteNames', () => service.noteNames())
  ipcMain.handle('hermes:vault:propertiesTable', () => service.propertiesTable())

  return service
}
