/**
 * The plugins Daat is built on have to be ON, on a machine nobody configured.
 *
 * `plugins/vault/plugin.yaml` declares `kind: standalone`, and hermes only
 * auto-loads bundled plugins of kind `backend` or `platform` — everything else
 * is opt-in through `plugins.enabled`. The seeded config.yaml is copied
 * verbatim from upstream, which has no `plugins:` block and no reason to have
 * one, and nothing in the installer or the desktop wrote it.
 *
 * So every fresh install shipped an agent with no vault_read, no vault_write,
 * no vault_search and no recall hook. Nothing looks broken — the editor, the
 * sidebar and search are all Electron and work fine — the agent just cannot
 * see the vault, and answers from nothing while sounding exactly as certain.
 *
 * @vitest-environment jsdom
 */

import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

let stored: Record<string, unknown>
let saves: Array<Record<string, unknown>>
let soulOk = true

vi.mock('@/hermes', () => ({
  getHermesConfigRecord: async () => structuredClone(stored),
  saveHermesConfig: async (config: Record<string, unknown>) => {
    saves.push(structuredClone(config))
    stored = structuredClone(config)

    return { ok: true }
  },
  updateProfileSoul: async () => ({ ok: soulOk })
}))

vi.mock('../vault/store', () => ({ refreshVaultNotes: async () => undefined }))

const { ensureDaatPlugins, applyPersona, PERSONAS } = await import('./persona-store')

const enabled = () => ((stored.plugins as { enabled?: string[] })?.enabled ?? []) as string[]

beforeEach(() => {
  stored = {}
  saves = []
  soulOk = true
})

test('a config with no plugins block gets Daat’s plugins turned on', async () => {
  await ensureDaatPlugins()

  assert.deepEqual(enabled().sort(), ['mail', 'meetings', 'vault'])
})

test('running it again writes nothing', async () => {
  await ensureDaatPlugins()

  const writes = saves.length

  await ensureDaatPlugins()

  assert.equal(saves.length, writes, 'it rewrote a config that already said the right thing')
})

test('a user who turned something off does not get it turned back on', async () => {
  // Only `vault` is unconditional — it IS the product. Someone who disabled
  // mail chose that, and a blunt overwrite would undo the choice silently.
  stored = { plugins: { enabled: ['meetings'] } }

  await ensureDaatPlugins()

  assert.deepEqual(enabled().sort(), ['meetings', 'vault'])
})

test('plugins the user added themselves survive', async () => {
  stored = { plugins: { enabled: ['vault', 'their-own-plugin'] } }

  await ensureDaatPlugins()

  assert.ok(enabled().includes('their-own-plugin'))
})

test('the vault memory provider is selected when nothing else is', async () => {
  // "Built-in only" is upstream's empty default, and the built-in store writes
  // to ~/.daat/memories — files the user cannot open. This is the setting that
  // makes end-of-session filing run at all.
  await ensureDaatPlugins()

  assert.equal((stored.memory as { provider?: string })?.provider, 'vault')
})

test('a provider the user chose is not replaced', async () => {
  stored = { memory: { provider: 'honcho' } }

  await ensureDaatPlugins()

  assert.equal((stored.memory as { provider?: string })?.provider, 'honcho')
})

test('enabling a plugin also exposes its toolset', async () => {
  // plugins.enabled loads the plugin; its tools then register under a toolset
  // of the same name, and a toolset missing from `toolsets:` is never
  // expanded. Fresh configs have neither block — writing only half the wiring
  // is exactly the "agent can't see my notes" fresh-Mac bug.
  stored = {}

  await ensureDaatPlugins()

  const toolsets = (stored.toolsets as string[]).sort()

  assert.deepEqual(toolsets, ['hermes-cli', 'mail', 'meetings', 'vault'])
})

test('seeding toolsets never strips the runtime default', async () => {
  // When the key is absent the runtime default is `hermes-cli`; the merge must
  // write it out, or materializing the key silently disables the base tools.
  stored = { plugins: { enabled: ['meetings'] } }

  await ensureDaatPlugins()

  assert.ok((stored.toolsets as string[]).includes('hermes-cli'))
  assert.ok((stored.toolsets as string[]).includes('vault'))
})

test('the rest of the config is left alone', async () => {
  stored = {
    toolsets: ['files'],
    model: { primary: 'claude-sonnet-5' },
    memory: { provider: 'vault', memory_char_limit: 2200 },
    plugins: { registry: 'x' }
  }

  await ensureDaatPlugins()

  // Toolsets the user already had survive; the plugin toolsets join them.
  assert.deepEqual((stored.toolsets as string[]).sort(), ['files', 'mail', 'meetings', 'vault'])
  assert.deepEqual(stored.model, { primary: 'claude-sonnet-5' })
  assert.equal((stored.plugins as Record<string, unknown>).registry, 'x', 'a sibling key under plugins was dropped')
  assert.equal(
    (stored.memory as Record<string, unknown>).memory_char_limit,
    2200,
    'a sibling key under memory was dropped'
  )
})

test('partial setup reports rejected settings and note writes while preserving existing blank notes', async () => {
  soulOk = false
  const persona = PERSONAS[0]
  const paths = Object.keys(persona.starters)
  const written: string[] = []
  window.hermesDesktop = {
    vault: {
      info: async () => ({ root: '/selected-vault' }),
      createNote: async (path: string, root: string) => {
        assert.equal(root, '/selected-vault')

        return { created: path !== paths[0], content: '', mtimeMs: 1 }
      },
      write: async (path: string, _content: string, _time: number, _base: string, root: string) => {
        assert.equal(root, '/selected-vault')
        written.push(path)

        return { ok: false, reason: 'unreadable' }
      }
    }
  } as unknown as typeof window.hermesDesktop
  const result = await applyPersona(persona.id)
  assert.equal(result.notesCreated, 0)
  assert.ok(result.soulError)
  assert.equal(result.errors.length, 1 + written.length)
  assert.ok(!written.includes(paths[0]), 'an existing empty note belongs to the user')
})
