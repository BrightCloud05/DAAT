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

/**
 * Folder, account, flag and message-id values, checked before they reach argv.
 *
 * Mirrors safe_name() in plugins/mail/himalaya.py. A leading dash turns the
 * value into a flag, and himalaya's `-c/--config` will load an arbitrary TOML
 * whose `auth.cmd` runs a shell command. These arrive over IPC, so they are
 * exactly as trustworthy as the renderer — which is to say, not.
 */
export function safeName(value: string, what: string): string {
  const clean = String(value ?? '').trim()

  if (!clean || clean.startsWith('-') || /[\r\n\0]/.test(clean)) {
    throw new Error(`invalid-${what.replace(/\s+/g, '-')}`)
  }

  return clean
}

/**
 * Split a search box into himalaya filter terms.
 *
 * Quoted phrases survive as one term: `subject "invoice 42"` is three words to
 * str.split and one condition to himalaya, and shredding it produces a query
 * that silently matches the wrong thing rather than failing.
 */
export function searchTerms(query: string): string[] {
  const terms: string[] = []

  for (const [, quoted, bare] of String(query ?? '').matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = quoted ?? bare

    if (term) {
      terms.push(term)
    }
  }

  // A term that starts with a dash would be read as a flag even after `--` is
  // consumed by the first one, so drop them rather than guess an escape.
  return terms.filter(term => !term.startsWith('-'))
}

/** Run himalaya for its exit code; organise commands print no JSON. */
async function runHimalayaRaw(args: string[], timeout = LIST_TIMEOUT_MS): Promise<void> {
  const exe = himalayaBinary()

  if (!exe) {
    throw new Error('himalaya-not-installed')
  }

  await execFileAsync(exe, args, { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } })
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

  /*
   * Organise: flag, move, search.
   *
   * The agent has had mail_flag/mail_move/mail_search since the plugin was
   * written; the person looking at their own inbox had none of them. That is
   * the wrong way round — the human is the one accountable for what happens to
   * their mail, and they were the one who could only look at it.
   *
   * Still nothing here leaves the machine. Composing and sending stay with the
   * agent, where the approval gate lives.
   */

  ipcMain.handle(
    'hermes:mail:flag',
    async (_event, opts: { id: string; flag: string; remove?: boolean; folder?: string; account?: string }) => {
      const args = ['flag', opts.remove ? 'remove' : 'add', '-f', safeName(opts.folder || 'INBOX', 'folder')]

      if (opts.account) {
        args.push('-a', safeName(opts.account, 'account'))
      }

      // Positionals go after every flag: himalaya folds anything following a
      // positional into it, so a flag placed last is silently swallowed.
      args.push('--', safeName(opts.id, 'message id'), safeName(opts.flag, 'flag'))

      await runHimalayaRaw(args)

      return true
    }
  )

  ipcMain.handle(
    'hermes:mail:move',
    async (_event, opts: { id: string; target: string; folder?: string; account?: string }) => {
      const args = ['message', 'move', '-f', safeName(opts.folder || 'INBOX', 'folder')]

      if (opts.account) {
        args.push('-a', safeName(opts.account, 'account'))
      }

      args.push('--', safeName(opts.target, 'target folder'), safeName(opts.id, 'message id'))

      await runHimalayaRaw(args)

      return true
    }
  )

  ipcMain.handle(
    'hermes:mail:search',
    async (_event, opts: { query: string; folder?: string; limit?: number; account?: string }) => {
      const terms = searchTerms(opts.query)

      if (!terms.length) {
        return []
      }

      const args = [
        'envelope',
        'list',
        '-f',
        safeName(opts.folder || 'INBOX', 'folder'),
        '-s',
        String(Math.min(Math.max(opts.limit || 30, 1), 100))
      ]

      if (opts.account) {
        args.push('-a', safeName(opts.account, 'account'))
      }

      args.push('-o', 'json', '--', ...terms)

      const data = (await runHimalaya(args)) as Array<Record<string, unknown>>

      return (Array.isArray(data) ? data : []).map(toEnvelope)
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
