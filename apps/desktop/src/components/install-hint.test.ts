/**
 * The install already writes a line before every long wait. These check that
 * the line becomes a sentence on the screen instead of staying behind a
 * disclosure nobody opens.
 *
 * The case that matters most is the fifteen-minute one: a Mac with no usable
 * git fires `xcode-select --install` and then polls for 900 seconds while
 * Apple's own dialog waits — possibly behind the window — for an answer.
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import { installHint } from './install-hint'

const line = (text: string) => ({ line: text })

test('the fifteen-minute wait says a dialog is waiting for you', () => {
  const hint = installHint([
    line('[INFO] Checking Git...'),
    line('[INFO] Requesting Apple Command Line Tools (provides git + compiler)...')
  ])

  assert.ok(hint)
  assert.equal(hint.needsYou, true, 'this wait is blocked on the user, not the network')
  assert.match(hint.body, /behind this window/i, 'the dialog opening behind the app is the actual trap')
})

test('the every-minute reminder keeps the same explanation on screen', () => {
  const hint = installHint([line('[INFO] Still waiting for Command Line Tools install (7m)...')])

  assert.equal(hint?.needsYou, true)
})

test('a long download says so, and says there is nothing to do', () => {
  const hint = installHint([line('[INFO] Downloading node-v22.23.2-darwin-arm64.tar.xz...')])

  assert.match(hint?.title ?? '', /node/i)
  assert.equal(hint?.needsYou, false)
})

test('the newest line wins, so a finished wait stops being announced', () => {
  // Otherwise the screen still says "press Install" long after the tools are in.
  const hint = installHint([
    line('[INFO] Requesting Apple Command Line Tools...'),
    line('[OK] Git 2.50.1 found'),
    line('[INFO] Installing Python dependencies')
  ])

  assert.equal(hint?.needsYou, false)
  assert.match(hint?.title ?? '', /parts I run on/i)
})

test('an ordinary log says nothing rather than inventing reassurance', () => {
  assert.equal(installHint([line('[OK] Detected: macos'), line('[OK] Configuration directory ready')]), null)
  assert.equal(installHint([]), null)
})

test('only recent lines count', () => {
  // An install that mentioned Apple's tools half an hour and two hundred lines
  // ago is not waiting on them now.
  const log = [line('Requesting Apple Command Line Tools...'), ...Array.from({ length: 100 }, () => line('...'))]

  assert.equal(installHint(log), null)
})

test('no line is explained in words that need explaining', () => {
  const jargon = /\b(venv|npm|uv|wheel|PATH|stdout|CLI|OAuth|repo)\b/

  const samples = [
    'Requesting Apple Command Line Tools',
    'Downloading node-v22',
    'uv pip sync',
    'Installing Playwright chromium',
    'Checking internet connectivity'
  ]

  for (const sample of samples) {
    const hint = installHint([line(sample)])

    assert.ok(hint, sample)
    assert.doesNotMatch(hint.title, jargon, `title for "${sample}"`)
    assert.doesNotMatch(hint.body, jargon, `body for "${sample}"`)
  }
})

test('"Installing Python dependencies" is the package step, not the Python download', () => {
  // These two lines differ by one word and mean completely different waits.
  // The looser rule used to claim both and tell the user the wrong thing about
  // the longest step in the install.
  assert.match(installHint([line('[INFO] Installing Python dependencies')])?.title ?? '', /parts I run on/i)
  assert.match(installHint([line('[INFO] Python 3.11 not found, installing via uv...')])?.title ?? '', /python/i)
})
