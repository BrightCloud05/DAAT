import assert from 'node:assert/strict'
import { test } from 'vitest'

import { coerceScalar, propertyEdit, readFrontmatter } from './frontmatter'

/** Apply an edit the way a CM dispatch would, so tests assert on the file. */
function apply(doc: string, edit: { from: number; to: number; insert: string } | null): string {
  assert.ok(edit, 'edit must not be refused')

  return doc.slice(0, edit!.from) + edit!.insert + doc.slice(edit!.to)
}

test('readFrontmatter parses the leading block and its range', () => {
  const doc = '---\ntitle: Hi\ntags: [a, b]\n---\nbody'
  const block = readFrontmatter(doc)

  assert.ok(block)
  assert.equal(block!.kind, 'ok')
  assert.equal(block!.from, 0)
  assert.equal(doc.slice(block!.to), 'body')
  assert.deepEqual(block!.props, { title: 'Hi', tags: ['a', 'b'] })
})

test('readFrontmatter distinguishes absent, invalid and non-map blocks', () => {
  assert.equal(readFrontmatter('no frontmatter'), null)
  assert.equal(readFrontmatter('---\n: [broken\n---\nbody')?.kind, 'invalid')
  assert.equal(readFrontmatter('---\n- a\n- b\n---\nbody')?.kind, 'other')
})

test('propertyEdit sets, adds, and deletes keys', () => {
  const doc = '---\nstatus: draft\n---\nbody'

  assert.equal(apply(doc, propertyEdit(doc, 'status', 'done')), '---\nstatus: done\n---\nbody')
  assert.equal(apply(doc, propertyEdit(doc, 'owner', 'joseph')), '---\nstatus: draft\nowner: joseph\n---\nbody')
  assert.equal(apply(doc, propertyEdit(doc, 'status', undefined)), 'body')
})

test('propertyEdit creates a block when none exists', () => {
  assert.equal(apply('just body', propertyEdit('just body', 'status', 'draft')), '---\nstatus: draft\n---\njust body')
})

test('editing one property leaves comments, key order and formatting alone', () => {
  // A re-dump through js-yaml would drop the comment, reorder the keys and
  // rewrite the inline list — all invisible to the user until they open the
  // file in another editor.
  const doc = ['---', '# what stage this is at', 'status: draft', 'tags: [a, b]', 'zzz: last', '---', 'body'].join('\n')

  const result = apply(doc, propertyEdit(doc, 'status', 'done'))

  assert.ok(result.includes('# what stage this is at'), 'comment must survive')
  assert.ok(result.includes('tags: [a, b]'), 'untouched values keep their formatting')
  assert.equal(result.indexOf('status'), doc.indexOf('status'), 'key order must not change')
  assert.ok(result.includes('status: done'))
  assert.ok(result.endsWith('---\nbody'))
})

test('multi-line values are replaced whole, not line-by-line', () => {
  const doc = '---\ntags:\n  - a\n  - b\nstatus: draft\n---\nbody'

  const result = apply(doc, propertyEdit(doc, 'tags', ['x']))

  assert.ok(!result.includes('- a'), 'the old list must be gone')
  assert.ok(result.includes('- x'))
  assert.ok(result.includes('status: draft'))
})

test('comments and blank lines between keys are not swallowed by the edit', () => {
  // Everything after a key up to the next one used to count as part of that
  // key's value, so editing `status` deleted the comment written above `tags`.
  const withComment = '---\nstatus: draft\n# why this matters\ntags: [a, b]\n---\nbody'

  assert.equal(
    apply(withComment, propertyEdit(withComment, 'status', 'done')),
    '---\nstatus: done\n# why this matters\ntags: [a, b]\n---\nbody'
  )

  const trailing = '---\ntitle: A\nstatus: draft\n# trailing note\n---\nbody'

  assert.equal(
    apply(trailing, propertyEdit(trailing, 'status', 'done')),
    '---\ntitle: A\nstatus: done\n# trailing note\n---\nbody'
  )

  const spaced = '---\ntitle: A\n\ntags: [a]\n---\nbody'

  assert.equal(apply(spaced, propertyEdit(spaced, 'title', 'B')), '---\ntitle: B\n\ntags: [a]\n---\nbody')
})

test('a malformed block is never rewritten', () => {
  // Rewriting prepends a second --- block above the broken one, and the panel
  // shows "no properties" — so the user can neither see nor repair it.
  const doc = '---\n: [broken\n---\nbody'

  assert.equal(propertyEdit(doc, 'status', 'done'), null)
})

test('a valid non-map block is never silently deleted', () => {
  const doc = '---\n- a\n- b\n---\nbody'

  assert.equal(propertyEdit(doc, 'status', 'done'), null)
})

test('coerceScalar types numbers and booleans', () => {
  assert.equal(coerceScalar('42'), 42)
  assert.equal(coerceScalar('true'), true)
  assert.equal(coerceScalar('hello'), 'hello')
  assert.equal(coerceScalar('2026-07-29'), '2026-07-29')
})
