import assert from 'node:assert/strict'
import { beforeEach, test } from 'vitest'

import { $productLocale, productStrings, syncProductLocale } from './strings'

beforeEach(() => {
  $productLocale.set('en')
})

test('English is the default — the language is a choice, not a guess', () => {
  assert.equal($productLocale.get(), 'en')
  assert.equal(productStrings().meetings, 'Meetings')
})

test('the product follows the app language setting', () => {
  syncProductLocale('ko')
  assert.equal($productLocale.get(), 'ko')
  assert.equal(productStrings().meetings, '회의록')

  syncProductLocale('en')
  assert.equal(productStrings().meetings, 'Meetings')
})

test('locales this catalogue has no translation for stay English', () => {
  // ja/zh/ar users get English Daat screens rather than a broken mix.
  for (const locale of ['ja', 'zh', 'zh-hant', 'ar'] as const) {
    syncProductLocale(locale)
    assert.equal($productLocale.get(), 'en', `${locale} must fall back to English`)
  }
})

test('an untranslated key falls back to English rather than rendering blank', () => {
  syncProductLocale('ko')

  const ko = productStrings()

  for (const [key, value] of Object.entries(ko)) {
    if (typeof value === 'string') {
      assert.ok(value.length > 0, `${key} is empty in Korean`)
    } else {
      assert.equal(typeof value, 'function', `${key} should be a string or a formatter`)
    }
  }
})

test('formatters interpolate in both languages', () => {
  syncProductLocale('en')
  assert.equal(productStrings().unreadCount(3), '3 unread')

  syncProductLocale('ko')
  assert.equal(productStrings().unreadCount(3), '읽지 않음 3개')
})
