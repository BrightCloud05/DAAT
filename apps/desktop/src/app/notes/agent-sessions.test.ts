/**
 * The agent panel had one conversation, no way to start another, and no
 * history. These cover the naming rule, which is the part that decides whether
 * the list is usable: a session usually has no title until the model writes
 * one, so most rows would read "Untitled" without a fallback.
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { sessionLabel } from './agent-sessions'

test('a titled session shows its title', () => {
  assert.equal(sessionLabel({ title: 'Lecture notes', preview: 'anything' }, 'Untitled'), 'Lecture notes')
})

test('an untitled session falls back to what the user actually said', () => {
  // This is the common case: the title arrives later, from the model.
  assert.equal(
    sessionLabel({ title: null, preview: 'can you tidy up my notes?' }, 'Untitled'),
    'can you tidy up my notes?'
  )
})

test('a whitespace-only title is not a title', () => {
  assert.equal(sessionLabel({ title: '   ', preview: 'real content' }, 'Untitled'), 'real content')
})

test('a long preview is cut to something a row can hold', () => {
  const label = sessionLabel({ title: null, preview: 'x'.repeat(200) }, 'Untitled')

  assert.equal(label.length, 60)
})

test('newlines in the preview collapse so a row stays one line', () => {
  assert.equal(
    sessionLabel({ title: null, preview: 'first line\n\n  second line' }, 'Untitled'),
    'first line second line'
  )
})

test('nothing at all falls back to the caller’s label', () => {
  assert.equal(sessionLabel({ title: null, preview: null }, '제목 없는 대화'), '제목 없는 대화')
  assert.equal(sessionLabel({ title: '', preview: '   ' }, 'Untitled chat'), 'Untitled chat')
})
