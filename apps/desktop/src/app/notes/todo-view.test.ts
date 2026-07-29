import assert from 'node:assert/strict'
import { test } from 'vitest'

import { decorateTodo, groupTodo } from './todo-view'

const base = { path: 'Daily/2026-07-29.md', line: 3, done: false }

test('due dates parse from the three conventions and drop out of the label', () => {
  for (const text of ['ship it 📅 2026-08-01', 'ship it due: 2026-08-01', 'ship it @2026-08-01']) {
    const todo = decorateTodo({ ...base, text })

    assert.equal(todo.due, '2026-08-01', text)
    assert.equal(todo.label, 'ship it', text)
  }

  const plain = decorateTodo({ ...base, text: 'no date here' })

  assert.equal(plain.due, null)
  assert.equal(plain.label, 'no date here')
})

test('grouping keys off the due date relative to today', () => {
  const today = '2026-07-29'

  assert.equal(groupTodo(decorateTodo({ ...base, text: 'a 📅 2026-07-28' }), today), 'overdue')
  assert.equal(groupTodo(decorateTodo({ ...base, text: 'a 📅 2026-07-29' }), today), 'today')
  assert.equal(groupTodo(decorateTodo({ ...base, text: 'a 📅 2026-08-05' }), today), 'upcoming')
  assert.equal(groupTodo(decorateTodo({ ...base, text: 'a' }), today), 'someday')
  assert.equal(groupTodo(decorateTodo({ ...base, text: 'a 📅 2026-07-28', done: true }), today), 'done')
})

test('the note chip uses the file name', () => {
  assert.equal(decorateTodo({ ...base, text: 'x' }).note, '2026-07-29')
})
