import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { VaultRecoveryEntry } from './vault-types'

/** Recovery lives outside the vault and survives renderer reloads and failed saves. */
export class VaultRecovery {
  private pending = new Map<string, Promise<void>>()
  constructor(private directory: string) {}

  private file(id: string): string {
    return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`)
  }

  private enqueue(id: string, action: () => Promise<void>): Promise<void> {
    const next = (this.pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(action)
    this.pending.set(id, next)
    void next
      .finally(() => {
        if (this.pending.get(id) === next) {
          this.pending.delete(id)
        }
      })
      .catch(() => undefined)

    return next
  }

  save(entry: VaultRecoveryEntry): Promise<void> {
    if (
      !entry ||
      !entry.id ||
      !entry.vaultRoot ||
      !entry.path ||
      typeof entry.content !== 'string' ||
      typeof entry.baseContent !== 'string' ||
      !Number.isFinite(entry.updatedAt) ||
      !Number.isFinite(entry.mtimeMs)
    ) {
      return Promise.reject(new Error('Invalid note recovery entry.'))
    }

    return this.enqueue(entry.id, async () => {
      await fs.mkdir(this.directory, { recursive: true })
      const target = this.file(entry.id)
      const temporary = `${target}.${randomUUID()}.tmp`

      try {
        const handle = await fs.open(temporary, 'wx', 0o600)

        try {
          await handle.writeFile(JSON.stringify(entry), 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }

        await fs.rename(temporary, target)
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined)
      }
    })
  }

  remove(id: string): Promise<void> {
    return this.enqueue(id, () => fs.rm(this.file(id), { force: true }))
  }

  async list(vaultRoot: string): Promise<VaultRecoveryEntry[]> {
    await Promise.all([...this.pending.values()].map(promise => promise.catch(() => undefined)))

    const names = await fs.readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }

      return []
    })

    const entries: VaultRecoveryEntry[] = []

    for (const name of names.filter(name => name.endsWith('.json'))) {
      try {
        const entry = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')) as VaultRecoveryEntry

        if (
          entry.vaultRoot === vaultRoot &&
          typeof entry.content === 'string' &&
          typeof entry.baseContent === 'string' &&
          Number.isFinite(entry.mtimeMs) &&
          Number.isFinite(entry.updatedAt) &&
          typeof entry.id === 'string' &&
          entry.id &&
          typeof entry.path === 'string' &&
          entry.path
        ) {
          entries.push(entry)
        }
      } catch {
        // A damaged journal must not hide other recoverable notes.
      }
    }

    return entries.sort((a, b) => a.updatedAt - b.updatedAt)
  }
}
