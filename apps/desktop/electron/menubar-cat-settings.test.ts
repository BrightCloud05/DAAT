import { expect, it } from 'vitest'

import { sanitizeCatSettings } from './menubar-cat-settings'

it('preserves existing preferences and ignores invalid flags and untrusted runtime paths', () => {
  const original = sanitizeCatSettings({ autoStart: false, showUsage: true })
  const edited = sanitizeCatSettings({ showCpu: false, showUsage: 'false', runtimeHome: '/wrong-profile' }, original)
  expect(edited.autoStart).toBe(false)
  expect(edited.showCpu).toBe(false)
  expect(edited.showUsage).toBe(true)
  expect(edited).not.toHaveProperty('runtimeHome')
})
