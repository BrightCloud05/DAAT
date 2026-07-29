/**
 * vault-ipc.ts
 *
 * The vault subsystem's single seam into main.ts: `initVaultIpc()` registers
 * every `hermes:vault:*` handler and returns the service so backend-env can
 * ask for VAULT_PATH / VAULT_INDEX_DB (M3). Renderer-facing surface mirrors
 * `window.hermesDesktop.vault.*` in preload.ts.
 */

import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { VaultService, defaultICloudVaultDir, defaultLocalVaultDir } from './vault-service'
import type { VaultConflictEvent, VaultIndexEvent } from './vault-types'

function broadcast(channel: string, payload: VaultIndexEvent | VaultConflictEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

/**
 * Publish the live vault root to the context bridge file. The backend is
 * spawned before a vault is restored, so its VAULT_PATH env can be empty —
 * the Python plugin reads this file to find the vault the user actually has
 * open (and the active note/selection on top).
 */
function writeVaultBridge(service: VaultService, extra: { activeNote?: string | null; selection?: string } = {}): void {
  try {
    const home = process.env.HERMES_HOME || path.join(app.getPath('home'), '.biseo')
    const target = path.join(home, 'state', 'vault-context.json')

    let previous: Record<string, unknown> = {}

    try {
      previous = JSON.parse(fs.readFileSync(target, 'utf8'))
    } catch {
      previous = {}
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(
      target,
      JSON.stringify(
        {
          ...previous,
          vault: service.info().root,
          ...('activeNote' in extra ? { active_note: extra.activeNote ?? null } : {}),
          ...('selection' in extra ? { selection: extra.selection ?? '' } : {}),
          updated_at: Date.now()
        },
        null,
        2
      ),
      'utf8'
    )
  } catch {
    // Best-effort: without the bridge the agent simply reports no vault.
  }
}

export function initVaultIpc(): VaultService {
  const service = new VaultService({
    onIndexEvent: event => {
      broadcast('hermes:vault:index-event', event)

      // A completed index means a vault is (still) open — keep the bridge
      // current so a backend spawned before the vault can still find it.
      if (event.type === 'index-complete' || event.type === 'vault-changed') {
        writeVaultBridge(service)
      }
    },
    onConflict: event => broadcast('hermes:vault:conflict', event)
  })

  void service.restore().then(() => writeVaultBridge(service))

  ipcMain.handle('hermes:vault:info', () => service.info())

  ipcMain.handle('hermes:vault:defaults', () => ({
    icloud: defaultICloudVaultDir(),
    local: defaultLocalVaultDir()
  }))

  ipcMain.handle('hermes:vault:create', async (_event, baseDir?: string) => {
    const info = await service.create(baseDir)

    writeVaultBridge(service)

    return info
  })

  ipcMain.handle('hermes:vault:choose', async event => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(window as BrowserWindow, {
      title: 'Open vault folder',
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths.length) {
      return null
    }

    const info = await service.open(result.filePaths[0])

    writeVaultBridge(service)

    return info
  })

  ipcMain.handle('hermes:vault:open', async (_event, root: string) => {
    const info = await service.open(root)

    writeVaultBridge(service)

    return info
  })
  ipcMain.handle('hermes:vault:reindex', () => service.reindex())
  ipcMain.handle('hermes:vault:list', () => service.list())
  ipcMain.handle('hermes:vault:listDir', (_event, subdir?: string) => service.listDir(subdir))
  ipcMain.handle('hermes:vault:read', (_event, relPath: string) => service.read(relPath))

  ipcMain.handle(
    'hermes:vault:write',
    (_event, relPath: string, content: string, expectedMtimeMs: number | null, expectedContent?: string) =>
      service.write(relPath, content, expectedMtimeMs ?? null, expectedContent)
  )

  ipcMain.handle('hermes:vault:createNote', (_event, relPath: string) => service.createNote(relPath))
  ipcMain.handle('hermes:vault:writeBinary', (_event, relPath: string, data: Uint8Array) =>
    service.writeBinary(relPath, data)
  )

  ipcMain.handle('hermes:vault:createDir', (_event, relPath: string) => service.createDir(relPath))
  ipcMain.handle('hermes:vault:rename', (_event, fromRel: string, toRel: string) => service.rename(fromRel, toRel))
  ipcMain.handle('hermes:vault:trash', (_event, relPath: string) => service.trash(relPath))
  ipcMain.handle('hermes:vault:search', (_event, query: string) => service.search(query))
  ipcMain.handle('hermes:vault:backlinks', (_event, relPath: string) => service.backlinks(relPath))
  ipcMain.handle('hermes:vault:linksFrom', (_event, relPath: string) => service.linksFrom(relPath))
  ipcMain.handle('hermes:vault:resolveWikilink', (_event, targetRaw: string) => service.resolveWikilink(targetRaw))
  // Current-note bridge: the renderer reports what the user is looking at;
  // the Python `vault` plugin reads this file in pre_llm_call so the agent
  // always knows the active note. Written under HERMES_HOME (never inside
  // the vault — no sync junk in the user's notes).
  ipcMain.on('hermes:vault:context', (_event, payload: { activeNote?: string; selection?: string }) => {
    writeVaultBridge(service, { activeNote: payload?.activeNote ?? null, selection: payload?.selection ?? '' })
  })

  ipcMain.handle('hermes:vault:noteNames', () => service.noteNames())
  ipcMain.handle('hermes:vault:propertiesTable', () => service.propertiesTable())
  ipcMain.handle('hermes:vault:todos', (_event, limit?: number) => service.todos(limit))
  ipcMain.handle('hermes:vault:toggleTodo', (_event, relPath: string, line: number, text?: string) =>
    service.toggleTodo(relPath, line, text)
  )

  return service
}
