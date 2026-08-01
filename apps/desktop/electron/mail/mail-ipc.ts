/**
 * mail-ipc.ts — the desktop's read-side bridge to Himalaya.
 *
 * The UI needs the inbox without going through the agent, so main shells out
 * to the same CLI the Python plugin uses (JSON output, argv only — never a
 * shell string). Everything here is READ/ORGANIZE; composing and sending
 * stay with the agent so they keep the approval gate.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { ipcMain } from 'electron'

const execFileAsync = promisify(execFile)

const LIST_TIMEOUT_MS = 45_000

export interface MailEnvelope {
  id: string
  subject: string
  fromName: string
  fromAddr: string
  date: string
  seen: boolean
  hasAttachment: boolean
}

/**
 * Where himalaya is, if it is anywhere.
 *
 * PATH comes first. The previous version checked four hard-coded directories
 * and nothing else, so anyone who installed via cargo (~/.cargo/bin) or a
 * custom prefix was told Mail was not installed while `himalaya` ran fine in
 * their terminal — with no way to tell why. The fixed list stays as a fallback
 * because a GUI app launched from Finder inherits a very short PATH that often
 * does not include Homebrew at all.
 */
function himalayaBinary(): string | null {
  const explicit = process.env.HIMALAYA_BIN?.trim()

  // An explicit setting is an answer either way: pointing it at something that
  // is not there means "not installed", not "go looking elsewhere". Tests and
  // support use this to reproduce a machine without it.
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null
  }

  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(dir => path.join(dir, 'himalaya'))

  const candidates = [
    ...onPath,
    path.join(os.homedir(), '.local', 'bin', 'himalaya'),
    path.join(os.homedir(), '.cargo', 'bin', 'himalaya'),
    '/opt/homebrew/bin/himalaya',
    '/usr/local/bin/himalaya',
    '/usr/bin/himalaya'
  ]

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

async function runHimalaya(args: string[], timeout = LIST_TIMEOUT_MS): Promise<unknown> {
  const exe = himalayaBinary()

  if (!exe) {
    throw new Error('himalaya-not-installed')
  }

  const { stdout } = await execFileAsync(exe, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' }
  })

  const text = stdout.trim()

  if (!text) {
    return []
  }

  const start = Math.min(...[text.indexOf('['), text.indexOf('{')].filter(index => index !== -1))

  return JSON.parse(Number.isFinite(start) && start > 0 ? text.slice(start) : text)
}

function toEnvelope(raw: Record<string, unknown>): MailEnvelope {
  const from = (raw.from ?? {}) as { name?: string; addr?: string }
  const flags = Array.isArray(raw.flags) ? (raw.flags as string[]) : []

  return {
    id: String(raw.id ?? ''),
    subject: String(raw.subject ?? '(no subject)'),
    fromName: from.name ?? from.addr ?? 'unknown',
    fromAddr: from.addr ?? '',
    date: String(raw.date ?? ''),
    seen: flags.includes('Seen'),
    hasAttachment: Boolean(raw.has_attachment)
  }
}

export function initMailIpc(): void {
  ipcMain.handle('hermes:mail:status', async () => {
    const exe = himalayaBinary()

    if (!exe) {
      return { installed: false, accounts: [] as Array<{ name: string; default: boolean }> }
    }

    try {
      const data = (await runHimalaya(['account', 'list', '-o', 'json'], 15_000)) as Array<Record<string, unknown>>

      return {
        installed: true,
        accounts: (Array.isArray(data) ? data : []).map(entry => ({
          name: String(entry.name ?? ''),
          default: Boolean(entry.default)
        }))
      }
    } catch {
      return { installed: true, accounts: [] }
    }
  })

  ipcMain.handle(
    'hermes:mail:list',
    async (_event, opts: { account?: string; folder?: string; limit?: number } = {}) => {
      const args = ['envelope', 'list', '-f', opts.folder || 'INBOX', '-s', String(Math.min(opts.limit || 30, 100))]

      if (opts.account) {
        args.push('-a', opts.account)
      }

      args.push('-o', 'json')

      const data = (await runHimalaya(args)) as Array<Record<string, unknown>>

      return (Array.isArray(data) ? data : []).map(toEnvelope)
    }
  )

  ipcMain.handle(
    'hermes:mail:read',
    async (_event, opts: { id: string; account?: string; folder?: string }) => {
      const args = ['message', 'read', '-f', opts.folder || 'INBOX', '--preview']

      if (opts.account) {
        args.push('-a', opts.account)
      }

      // `--` terminates option parsing. Without it an id beginning with `-`
      // is read as a flag, and himalaya's `-c/--config` would load an
      // arbitrary TOML whose `auth.cmd` runs a shell command — the same hole
      // that was closed in plugins/mail/himalaya.py. The id comes over IPC, so
      // it is only as trustworthy as the renderer.
      args.push('--', opts.id)

      const exe = himalayaBinary()

      if (!exe) {
        throw new Error('himalaya-not-installed')
      }

      const { stdout } = await execFileAsync(exe, args, {
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1' }
      })

      return stdout
    }
  )

  ipcMain.handle('hermes:mail:folders', async (_event, opts: { account?: string } = {}) => {
    const args = ['folder', 'list']

    if (opts.account) {
      args.push('-a', opts.account)
    }

    args.push('-o', 'json')

    const data = (await runHimalaya(args)) as Array<Record<string, unknown>>

    return (Array.isArray(data) ? data : []).map(entry => String(entry.name ?? ''))
  })
}
