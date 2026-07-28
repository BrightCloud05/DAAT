import assert from 'node:assert/strict'
import { test } from 'vitest'

import { coerceScalar, propertyEdit, readFrontmatter } from './frontmatter'

test('readFrontmatter parses the leading block and its range', () => {
  const doc = '---\ntitle: Hi\ntags: [a, b]\n---\nbody'
  const block = readFrontmatter(doc)

  assert.ok(block)
  assert.equal(block!.from, 0)
  assert.equal(doc.slice(block!.to), 'body')
  assert.deepEqual(block!.props, { title: 'Hi', tags: ['a', 'b'] })
})

test('readFrontmatter returns null without a block or on bad yaml', () => {
  assert.equal(readFrontmatter('no frontmatter'), null)
  assert.equal(readFrontmatter('---\n: [broken\n---\nbody'), null)
})

test('propertyEdit sets, adds, and deletes keys', () => {
  const doc = '---\nstatus: draft\n---\nbody'

  const set = propertyEdit(doc, 'status', 'done')

  assert.ok(set.insert.includes('status: done'))

  const add = propertyEdit(doc, 'owner', 'joseph')

  assert.ok(add.insert.includes('status: draft'))
  assert.ok(add.insert.includes('owner: joseph'))

  const del = propertyEdit(doc, 'status', undefined)

  assert.equal(del.insert, '')
  assert.equal(del.from, 0)
  assert.equal(doc.slice(del.to), 'body')
})

test('propertyEdit creates a block when none exists', () => {
  const edit = propertyEdit('just body', 'status', 'draft')

  assert.equal(edit.from, 0)
  assert.equal(edit.to, 0)
  assert.ok(edit.insert.startsWith('---\n'))
  assert.ok(edit.insert.endsWith('---\n'))
})

test('coerceScalar types numbers and booleans', () => {
  assert.equal(coerceScalar('42'), 42)
  assert.equal(coerceScalar('true'), true)
  assert.equal(coerceScalar('hello'), 'hello')
  assert.equal(coerceScalar('2026-07-29'), '2026-07-29')
})
