/**
 * The prompt fence.
 *
 * Every section of the inline-assistant prompt is wrapped in a delimiter so the
 * model can tell the passage it must rewrite from the surrounding context. That
 * delimiter used to be a bare triple quote — which ordinary notes contain all
 * the time. A Python docstring, a quoted block, a JSON sample: the fence closed
 * early, and the model saw the rest of the passage as loose text outside the
 * section it had been told to rewrite. "Make this shorter" then shortened the
 * first line and mangled the rest.
 */

import assert from 'node:assert/strict'
import { test } from 'vitest'

import { fence } from './inline-ai-store'

/** How many sections a reader would find in this block. */
function sections(block: string): number {
  const mark = /^("{3,})$/m.exec(block)?.[1]

  return mark ? (block.match(new RegExp(`^${mark}$`, 'gm')) ?? []).length / 2 : 0
}

test('a plain passage is wrapped in one balanced pair', () => {
  const block = fence('THE PASSAGE:', 'nothing special here')

  assert.equal(sections(block), 1)
  assert.ok(block.includes('nothing special here'))
})

test('a passage containing a triple quote does not close the fence early', () => {
  const passage = 'def f():\n    """Return one."""\n    return 1'
  const block = fence('THE PASSAGE:', passage)
  const mark = /^("{3,})$/m.exec(block)?.[1] ?? ''

  assert.ok(mark.length > 3, `delimiter must grow past the content; got ${mark.length} quotes`)
  assert.equal(sections(block), 1, 'still exactly one section')
  assert.ok(block.includes(passage), 'and the passage is unchanged')
})

test('the passage is never escaped or altered', () => {
  // Escaping would change the text the model is asked to rewrite, and it would
  // faithfully reproduce the escapes in its answer.
  const passage = '"""\n""""\nmixed """ quoting'

  assert.ok(fence('X:', passage).includes(passage))
})

test('an odd number of triple quotes cannot shift the boundary', () => {
  // The dangerous case: one unbalanced delimiter shifts every later boundary
  // instead of accidentally re-balancing.
  const block = fence('THE PASSAGE:', 'a """ b')

  assert.equal(sections(block), 1)
})

test('the delimiter grows only as far as it must', () => {
  const mark = /^("{3,})$/m.exec(fence('X:', 'has """ inside'))?.[1] ?? ''

  assert.equal(mark, '""""', 'four quotes is enough to clear a three-quote body')
})

test('a body made entirely of escalating quotes still terminates', () => {
  const passage = ['"""', '""""', '"""""', '""""""'].join('\n')
  const block = fence('X:', passage)

  assert.equal(sections(block), 1)
  assert.ok(block.includes(passage))
})
