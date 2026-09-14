/**
 * A recorded meeting is unrepeatable. Losing it is the worst thing this app does.
 *
 * The capture used to live in a `Blob[]` in renderer memory and only become a
 * file at stop(). The 5-second timeslice was there with a comment saying it
 * existed so a crash mid-meeting could not lose everything — but nothing ever
 * wrote a chunk, so it protected nothing at all. Quitting, closing the window,
 * or unplugging the microphone took the whole meeting.
 *
 * Worse, nothing observed the capture ending on its own. Chromium auto-stops
 * the recorder when the stream dies, so a later stop() threw InvalidStateError
 * out of a Promise executor that sat outside every catch: the panel froze on a
 * disabled "Loading…", the interval leaked, and the audio was discarded.
 *
 * @vitest-environment jsdom
 */

import assert from 'node:assert/strict'

import { afterEach, beforeEach, test, vi } from 'vitest'

import { $recorder, cancelRecording, startRecording, stopRecording } from './recorder'

/** What the vault saw, keyed by path — the only proof anything was written. */
let disk: Record<string, number[]>
let trashed: string[]
let appendFails: string | null

/** The live fake, so a test can end the stream or fire an error. */
let active: FakeRecorder | null = null

class FakeTrack extends EventTarget {
  stopped = false

  stop() {
    this.stopped = true
  }

  /** The device was unplugged. */
  end() {
    this.stopped = true
    this.dispatchEvent(new Event('ended'))
  }
}

class FakeStream {
  tracks = [new FakeTrack()]

  getTracks() {
    return this.tracks
  }

  getAudioTracks() {
    return this.tracks
  }
}

class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  mimeType = 'audio/webm'

  constructor(public stream: FakeStream) {
    active = this
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    if (this.state === 'inactive') {
      throw new DOMException('The MediaRecorder is not recording', 'InvalidStateError')
    }

    this.state = 'inactive'
    this.onstop?.()
  }

  /** A timesliced chunk arrives. */
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) })
  }

  /** Chromium's behaviour when the stream dies: flush, then auto-stop. */
  die(final = '') {
    if (final) {
      this.emit(final)
    }

    this.state = 'inactive'
    this.onerror?.()
  }
}

beforeEach(() => {
  disk = {}
  trashed = []
  appendFails = null
  active = null

  vi.stubGlobal('MediaRecorder', Object.assign(FakeRecorder, { isTypeSupported: () => true }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => new FakeStream() } })
  vi.stubGlobal('window', {
    ...globalThis.window,
    hermesDesktop: {
      vault: {
        appendBinary: async (relPath: string, data: Uint8Array) => {
          if (appendFails) {
            throw new Error(appendFails)
          }

          disk[relPath] = [...(disk[relPath] ?? []), ...data]

          return { path: relPath, bytes: disk[relPath].length }
        },
        trash: async (relPath: string) => {
          trashed.push(relPath)
          delete disk[relPath]
        }
      }
    }
  })
})

afterEach(async () => {
  await cancelRecording().catch(() => undefined)
  vi.unstubAllGlobals()
})

/** Let the serialized append chain drain. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve()
  }
}

test('a chunk is on disk before anyone presses stop', async () => {
  assert.equal(await startRecording('Standup'), true)

  active?.emit('first five seconds')
  await settle()

  const [path] = Object.keys(disk)

  assert.ok(path?.endsWith('/audio.webm'), `nothing was written: ${JSON.stringify(disk)}`)
  assert.ok(disk[path].length > 0)
})

test('unplugging the microphone keeps what was recorded and does not wedge the panel', async () => {
  await startRecording('Board meeting')

  active?.emit('the first ten minutes')
  await settle()

  // The USB mic is pulled. Chromium flushes and auto-stops; nothing used to
  // notice, so the timer kept climbing and Stop then threw.
  active?.die('the last partial chunk')
  await settle()

  const state = $recorder.get()

  assert.equal(state.status, 'recording', 'the user must still be able to press Stop')
  assert.ok(state.interrupted, 'the screen has to say the microphone went away')

  const result = await stopRecording()

  assert.ok(result, 'the meeting was thrown away')
  assert.ok(disk[result.audioPath].length > 0, 'the audio is gone')
  assert.equal($recorder.get().status, 'idle', 'the panel is stuck')
})

test('an ended audio track is noticed too', async () => {
  await startRecording('Call')

  active?.emit('some audio')
  await settle()

  active?.stream.tracks[0].end()
  await settle()

  assert.ok($recorder.get().interrupted)
})

test('stop on an already-inactive recorder returns the recording instead of throwing', async () => {
  await startRecording('Interview')

  active?.emit('everything that was said')
  await settle()
  active!.state = 'inactive'

  const result = await stopRecording()

  assert.ok(result, 'InvalidStateError escaped and the recording was lost')
  assert.ok(disk[result.audioPath].length > 0)
})

test('discard takes the partial file with it', async () => {
  await startRecording('Never mind')

  active?.emit('half a sentence')
  await settle()

  const [path] = Object.keys(disk)

  await cancelRecording()

  assert.deepEqual(trashed, [path])
  assert.equal($recorder.get().status, 'idle')
})

test('a recording that captured nothing is reported, not saved as an empty file', async () => {
  await startRecording('Silence')
  await settle()

  const result = await stopRecording()

  assert.equal(result, null)
  assert.equal($recorder.get().status, 'error')
})

test('a write that fails keeps the path, because a partial recording still beats none', async () => {
  await startRecording('Full disk')

  appendFails = 'ENOSPC: no space left on device'
  active?.emit('audio that cannot land')
  await settle()

  const result = await stopRecording()

  assert.equal(result, null)
  assert.match($recorder.get().error ?? '', /ENOSPC/)
  assert.match($recorder.get().error ?? '', /audio\.webm/)
  assert.deepEqual(trashed, [], 'the file was deleted out from under the user')
})

test('a recorder that cannot be constructed leaves no microphone running', async () => {
  const stopped: FakeTrack[] = []

  vi.stubGlobal(
    'MediaRecorder',
    Object.assign(
      class {
        constructor() {
          throw new Error('unsupported container')
        }
      },
      { isTypeSupported: () => true }
    )
  )

  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        const stream = new FakeStream()

        stopped.push(...stream.tracks)

        return stream
      }
    }
  })

  assert.equal(await startRecording('Doomed'), false)
  assert.equal($recorder.get().status, 'error')
  assert.ok(stopped.every(track => track.stopped), 'the microphone was left live with nothing on screen')
})
