import assert from 'node:assert/strict'

import { afterEach, beforeEach, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  preferences: vi.fn(),
  prompt: '',
  error: null as string | null,
  files: new Map<string, string>(),
  listeners: new Set<(event: unknown) => void>()
}))

vi.mock('@/hermes', () => ({
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1000,
  getProfileSoul: async () => ({ content: 'Original preferences' }),
  updateProfileSoul: state.preferences
}))
vi.mock('../vault/store', async () => {
  const { atom } = await import('nanostores')
  const notes = atom<Array<{ path: string }>>([])

  return {
    $vaultInfo: atom({ root: '/vault-a' }),
    $vaultNotes: notes,
    refreshVaultNotes: async () => {
      notes.set([...state.files.keys()].map(path => ({ path })))
    }
  }
})
vi.mock('@/store/gateway', () => ({
  activeGateway: () => ({
    request: async (method: string, args: { text?: string }) => {
      if (method === 'session.create') {return { session_id: 'setup-session' }}

      if (method === 'prompt.submit') {
        state.prompt = args.text ?? ''

        const emit = (type: string, payload: unknown) => {
          for (const listener of state.listeners) {listener({ type, payload, session_id: 'setup-session' })}
        }

        state.files.set('Imported.md', 'Verified content')
        state.files.set('Unrelated.md', 'Concurrent external note')
        emit('tool.complete', {
          name: 'vault_write',
          args: { path: 'Imported.md', content: 'Verified content' },
          result: 'Wrote Imported.md (16 chars).'
        })
        emit('message.complete', { text: 'Imported the supplied file.', error: state.error })
      }

      return {}
    },
    onEvent: (listener: (event: unknown) => void) => {
      state.listeners.add(listener)

      return () => state.listeners.delete(listener)
    }
  })
}))
import { PERSONAS } from './personas'
import { $setup, answerQuestion, endSetup, offerFilesToSetup, undoStep } from './setup-agent'
const persona = PERSONAS.find(item => item.questions.some(question => question.kind === 'preferences'))!
beforeEach(async () => {
  await endSetup()
  state.files.clear()
  state.prompt = ''
  state.error = null
  state.preferences.mockReset().mockResolvedValue({ ok: true })
  window.hermesDesktop = {
    vault: {
      read: async (path: string) => ({ content: state.files.get(path) ?? '', dataless: false }),
      trash: async (path: string, root: string) => {
        assert.equal(root, '/vault-a')
        state.files.delete(path)
      }
    }
  } as unknown as typeof window.hermesDesktop
})
afterEach(endSetup)
test('dropped files run a real gateway turn instead of becoming preferences; undo owns only unchanged confirmed output', async () => {
  await offerFilesToSetup(persona, ['/supplied/document.pdf'])
  assert.equal(state.preferences.mock.calls.length, 0)
  assert.match(state.prompt, /Read the supplied files/)
  assert.ok(!state.prompt.includes('undefined'))
  assert.equal($setup.get().status, 'asking')
  assert.equal($setup.get().index, 0)
  assert.deepEqual($setup.get().steps[0].created, ['Imported.md'])
  assert.match($setup.get().result ?? '', /Imported/)
  state.files.set('Imported.md', 'User edited the result')
  await undoStep(0)
  assert.equal(state.files.get('Imported.md'), 'User edited the result')
  assert.equal(state.files.get('Unrelated.md'), 'Concurrent external note')
  state.files.set('Imported.md', 'Verified content')
  await undoStep(0)
  assert.equal(state.files.has('Imported.md'), false)
  assert.equal(state.files.has('Unrelated.md'), true)
})
test('failed preference writes and failed agent turns remain retryable at the same question', async () => {
  state.preferences.mockResolvedValueOnce({ ok: false })
  assert.equal(await answerQuestion(persona, 'Always cite sources'), false)
  assert.equal($setup.get().index, 0)
  assert.ok($setup.get().error)
  state.error = 'File could not be read'
  await offerFilesToSetup(persona, ['/supplied/broken.pdf'])
  assert.equal($setup.get().status, 'asking')
  assert.equal($setup.get().error, state.error)
  assert.equal($setup.get().index, 0)
})
