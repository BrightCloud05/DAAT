import assert from 'node:assert/strict'
import { test } from 'vitest'

import { parseNote } from './vault-parser'

test('title precedence: frontmatter > first H1 > filename fallback', () => {
  assert.equal(parseNote('---\ntitle: FM Title\n---\n# H1', 'file').title, 'FM Title')
  assert.equal(parseNote('# H1 Title\nbody', 'file').title, 'H1 Title')
  assert.equal(parseNote('just text', 'file').title, 'file')
})

test('extracts wikilinks with aliases and headings, skipping code', () => {
  const parsed = parseNote(
    ['See [[Other Note]] and [[Target|the label]].', '', '```', 'not a [[Link In Code]]', '```', '', '`[[inline]]`'].join(
      '\n'
    ),
    'file'
  )

  const targets = parsed.links.map(link => link.targetRaw)

  assert.deepEqual(targets, ['Other Note', 'Target'])
  assert.ok(parsed.links[0].line >= 1)
})

test('heading fragments strip to the note target', () => {
  const parsed = parseNote('[[Note Name#Section]]', 'file')

  assert.deepEqual(
    parsed.links.map(l => l.targetRaw),
    ['Note Name#Section']
  )
})

test('collects tags from body and frontmatter, not from code or URLs', () => {
  const parsed = parseNote(
    ['---', 'tags: [alpha, beta]', '---', 'Body with #gamma and #한글태그.', '', '```', '#!/bin/bash', '```'].join('\n'),
    'file'
  )

  assert.deepEqual([...parsed.tags].sort(), ['alpha', 'beta', 'gamma', '한글태그'])
})

test('plain text is searchable and syntax-stripped', () => {
  const parsed = parseNote('# Head\n\nSome **bold** text with [[Link]].', 'file')

  assert.ok(parsed.plainText.includes('Some bold text'))
  assert.ok(!parsed.plainText.includes('**'))
})

test('malformed frontmatter degrades gracefully', () => {
  const parsed = parseNote('---\n: not yaml [\n---\ncontent here', 'file')

  assert.equal(parsed.title, 'file')
  assert.ok(parsed.plainText.length > 0)
})
