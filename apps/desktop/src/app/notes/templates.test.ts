import assert from 'node:assert/strict'

import { test } from 'vitest'

import { fillTemplate, todayStamp } from './templates'

test('a selected daily-note date fills every date marker independently of today', () => {
  const picked = '1999-12-31'
  assert.equal(
    fillTemplate('---\ndate: {{date}}\n---\n# {{title}}\n{{date}}', picked, picked),
    `---\ndate: ${picked}\n---\n# ${picked}\n${picked}`
  )
  const localMidnight = new Date(2026, 8, 15, 0, 5)
  assert.equal(todayStamp(localMidnight), '2026-09-15')
})
