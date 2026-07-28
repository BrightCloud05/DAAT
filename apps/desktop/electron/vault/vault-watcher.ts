/**
 * vault-watcher.ts
 *
 * Watches the vault folder with @parcel/watcher and turns raw FS events into
 * debounced, content-aware note events. iCloud materialization/eviction and
 * sync temp files fire storms of events with no real edits — every event is
 * therefore (a) debounced 300ms per path and (b) content-hash-compared by the
 * consumer before reindexing, so downstream work only happens on real change.
 */

import watcher from '@parcel/watcher'
import path from 'node:path'

import { icloudPlaceholderTarget, isMarkdownFile } from './vault-fs'

const DEBOUNCE_MS = 300

/** Directory names that are never vault content. */
const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules', '.Trash'])

export interface VaultWatcherEvent {
  type: 'changed' | 'deleted'
  /** Vault-relative POSIX path of the affected note. */
  relPath: string
}

export interface VaultWatcher {
  close(): Promise<void>
}

function isIgnored(relPath: string): boolean {
  return relPath.split('/').some(part => IGNORED_DIRS.has(part) || part.startsWith('.tmp-') || /\.tmp-[0-9a-f]+$/.test(part))
}

export async function watchVault(
  root: string,
  onEvents: (events: VaultWatcherEvent[]) => void
): Promise<VaultWatcher> {
  const pending = new Map<string, VaultWatcherEvent>()
  let timer: NodeJS.Timeout | null = null

  const flush = () => {
    timer = null

    const events = [...pending.values()]

    pending.clear()

    if (events.length) {
      onEvents(events)
    }
  }

  const subscription = await watcher.subscribe(root, (error, events) => {
    if (error) {
      return
    }

    for (const event of events) {
      let relPath = path.relative(root, event.path).split(path.sep).join('/')
      const base = path.posix.basename(relPath)

      // `.Note.md.icloud` placeholder appearing/disappearing IS a change to
      // the real note's local availability — surface it as the real note.
      const placeholderTarget = icloudPlaceholderTarget(base)

      if (placeholderTarget) {
        relPath = path.posix.join(path.posix.dirname(relPath), placeholderTarget)
      }

      if (isIgnored(relPath) || !isMarkdownFile(relPath)) {
        continue
      }

      // parcel event types: create/update -> changed; delete -> deleted.
      // A delete immediately followed by create (atomic rename) coalesces to
      // the later event because the map keeps only the last one per path.
      pending.set(relPath, {
        type: event.type === 'delete' && !placeholderTarget ? 'deleted' : 'changed',
        relPath
      })
    }

    if (!timer && pending.size) {
      timer = setTimeout(flush, DEBOUNCE_MS)
    }
  })

  return {
    close: async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      pending.clear()
      await subscription.unsubscribe()
    }
  }
}
