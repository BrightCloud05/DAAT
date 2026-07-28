import assert from 'node:assert/strict'
import { test } from 'vitest'

import { parser as markdownParser } from '@lezer/markdown'

import { splitWikilink, wikiLinkExtension } from './wikilink-language'

const parser = markdownParser.configure([wikiLinkExtension])

function nodeNames(doc: string): string[] {
  const names: string[] = []

  parser.parse(doc).iterate({
    enter: node => {
      names.push(node.name)
    }
  })

  return names
}

test('parses [[Target]] into WikiLink with marks', () => {
  const names = nodeNames('See [[Other Note]] here')

  assert.ok(names.includes('WikiLink'))
  assert.equal(names.filter(n => n === 'WikiLinkMark').length, 2)
})

test('does not parse across newlines, empty links, or inside code', () => {
  assert.ok(!nodeNames('a [[broken\nlink]] b').includes('WikiLink'))
  assert.ok(!nodeNames('a [[]] b').includes('WikiLink'))

  const fenced = nodeNames('```\n[[not a link]]\n```')

  assert.ok(!fenced.includes('WikiLink'))
})

test('regular markdown links still parse', () => {
  const names = nodeNames('[title](https://example.com) and [[Wiki]]')

  assert.ok(names.includes('Link'))
  assert.ok(names.includes('WikiLink'))
})

test('splitWikilink handles aliases and trims', () => {
  assert.deepEqual(splitWikilink('Target'), { target: 'Target', label: 'Target' })
  assert.deepEqual(splitWikilink('Target|nice label'), { target: 'Target', label: 'nice label' })
  assert.deepEqual(splitWikilink(' Target #x '.replace('#x', '')), { target: 'Target', label: 'Target' })
})
