/**
 * Meeting recorder.
 *
 * Records with MediaRecorder and writes the result into the vault as an
 * ordinary file next to the meeting note — so the recording is the user's,
 * in a folder they can open, and deleting the note's folder deletes the
 * audio with it. Nothing is uploaded: transcription happens on this Mac
 * through the local Whisper model.
 *
 * Recording is a live capture of a room that may contain other people, so
 * this module never starts implicitly — only from an explicit user action —
 * and the UI shows a running timer the whole time.
 */

import { atom } from 'nanostores'

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'saving' | 'error'

export interface RecorderState {
  status: RecorderStatus
  /** Seconds elapsed, for the timer. */
  elapsed: number
  error: string | null
  /** Vault-relative folder of the recording in progress. */
  folder: string | null
  /**
   * Set while status is still 'recording' when the capture has stopped on its
   * own — the microphone was unplugged, or MediaRecorder errored. What was
   * captured is already on disk; the user presses Stop and keeps it.
   */
  interrupted?: string | null
}

const IDLE: RecorderState = { status: 'idle', elapsed: 0, error: null, folder: null }

export const $recorder = atom<RecorderState>(IDLE)

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let startedAt = 0

/*
 * The recording goes to disk as it happens.
 *
 * It used to accumulate in a `Blob[]` in renderer memory and only become a file
 * at stop(). The 5-second timeslice was there, with a comment saying it existed
 * so a crash mid-meeting could not lose everything — but nothing ever wrote a
 * chunk, so it protected nothing. Quitting, closing the window, unplugging the
 * microphone, or a renderer reload took the whole meeting with it.
 *
 * Now each chunk is appended as it arrives, through a serialized chain so two
 * appends can never interleave. What has been said is on disk, always.
 */
let audioPath: string | null = null
let writeChain: Promise<void> = Promise.resolve()
let writtenBytes = 0
let writeError: string | null = null

/** `Meetings/2026-07-29 1432 Standup` — sortable, and readable in Finder. */
export function meetingFolder(title: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(
    now.getMinutes()
  )}`

  // Keep it a valid single path segment on every filesystem.
  const safe = title
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

  return `Meetings/${stamp}${safe ? ` ${safe}` : ''}`
}

/** The best container this build of Chromium will actually produce. */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

  return candidates.find(type => MediaRecorder.isTypeSupported?.(type))
}

export function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export async function startRecording(title: string): Promise<boolean> {
  if ($recorder.get().status === 'recording') {
    return false
  }

  $recorder.set({ ...IDLE, status: 'requesting' })

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    })
  } catch (error) {
    // Denied, or no input device. Both are the user's business to fix.
    $recorder.set({
      ...IDLE,
      status: 'error',
      error:
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Daat needs microphone access. Grant it in System Settings → Privacy & Security → Microphone.'
          : error instanceof Error
            ? error.message
            : 'No microphone available.'
    })

    return false
  }

  const mimeType = pickMimeType()

  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  } catch (error) {
    // Constructing it can fail on an unsupported container. Left unhandled,
    // this threw out of startRecording with the stream still open — the
    // microphone stayed live, with nothing on screen saying so.
    teardown()
    $recorder.set({
      ...IDLE,
      status: 'error',
      error: error instanceof Error ? error.message : 'This Mac could not start a recording.'
    })

    return false
  }

  const folder = meetingFolder(title, new Date())

  audioPath = `${folder}/audio.${(mimeType ?? '').includes('mp4') ? 'm4a' : 'webm'}`
  writeChain = Promise.resolve()
  writtenBytes = 0
  writeError = null

  recorder.ondataavailable = event => {
    if (event.data.size === 0 || !audioPath) {
      return
    }

    const chunk = event.data
    const target = audioPath

    writeChain = writeChain.then(async () => {
      try {
        const result = await window.hermesDesktop.vault.appendBinary(
          target,
          new Uint8Array(await chunk.arrayBuffer())
        )

        writtenBytes = result.bytes
      } catch (error) {
        // Remember the first failure. Later chunks still try — a full disk that
        // frees up mid-meeting should not doom the rest of it.
        writeError ??= error instanceof Error ? error.message : 'Could not write the recording.'
      }
    })
  }

  // The capture can end without anyone asking it to: the device is unplugged,
  // the track ends, the recorder errors. None of that was observed, so the
  // timer kept climbing over a dead microphone and Stop then threw.
  recorder.onerror = () => {
    interrupt('The microphone stopped working.')
  }

  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      interrupt('The microphone was disconnected.')
    })
  }

  try {
    recorder.start(5_000)
  } catch (error) {
    teardown()
    $recorder.set({
      ...IDLE,
      status: 'error',
      error: error instanceof Error ? error.message : 'This Mac could not start a recording.'
    })

    return false
  }

  startedAt = Date.now()

  $recorder.set({ status: 'recording', elapsed: 0, error: null, folder, interrupted: null })

  ticker = setInterval(() => {
    const current = $recorder.get()

    if (current.status === 'recording' && !current.interrupted) {
      $recorder.set({ ...current, elapsed: Math.floor((Date.now() - startedAt) / 1000) })
    }
  }, 1000)

  return true
}

/**
 * The capture stopped on its own. Freeze the timer and say so, but stay in
 * 'recording' so the user's next press of Stop saves what was captured — which
 * is on disk already.
 */
function interrupt(reason: string): void {
  const current = $recorder.get()

  if (current.status !== 'recording' || current.interrupted) {
    return
  }

  $recorder.set({ ...current, interrupted: reason })
}

function teardown(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }

  stream?.getTracks().forEach(track => track.stop())
  stream = null
  recorder = null
}

export interface FinishedRecording {
  /** Vault-relative path of the audio file. */
  audioPath: string
  folder: string
  seconds: number
}

/** Stop, finish writing the audio into the vault, and return where it landed. */
export async function stopRecording(): Promise<FinishedRecording | null> {
  const current = $recorder.get()

  if (current.status !== 'recording' || !recorder || !audioPath) {
    return null
  }

  const active = recorder
  const folder = current.folder ?? meetingFolder('', new Date())
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  const target = audioPath

  $recorder.set({ ...current, status: 'saving' })

  try {
    // `inactive` means the recorder already auto-stopped — the stream went away
    // and Chromium flushed a final chunk. Calling stop() again throws
    // InvalidStateError, and it used to throw from inside a Promise executor
    // outside every catch: the panel froze on a disabled "Loading…" and the
    // whole meeting was discarded.
    if (active.state !== 'inactive') {
      await new Promise<void>(resolve => {
        active.onstop = () => resolve()
        active.stop()
      })
    }

    // Every chunk, including the final flush, has to reach disk before we
    // report where it landed.
    await writeChain
  } catch (error) {
    teardown()
    $recorder.set({
      ...IDLE,
      status: 'error',
      error: error instanceof Error ? error.message : 'Could not finish the recording.'
    })

    return null
  }

  teardown()
  audioPath = null

  if (writeError) {
    // Do not delete the file: a partial recording is worth more than none, and
    // the path is the only way back to it.
    $recorder.set({ ...IDLE, status: 'error', error: `${writeError} The audio so far is at ${target}.` })

    return null
  }

  if (!writtenBytes) {
    await window.hermesDesktop.vault.trash(target).catch(() => undefined)
    $recorder.set({ ...IDLE, status: 'error', error: 'The recording came out empty — nothing was captured.' })

    return null
  }

  $recorder.set(IDLE)

  return { audioPath: target, folder, seconds }
}

/** Abandon a recording without keeping it. */
export async function cancelRecording(): Promise<void> {
  const target = audioPath

  // The same `inactive` guard as above: Discard used to throw here too, before
  // it reached the reset below, leaving the panel stuck on a fake recording
  // screen with a running timer and no way out.
  if (recorder && recorder.state !== 'inactive' && $recorder.get().status === 'recording') {
    recorder.onstop = null
    recorder.stop()
  }

  teardown()
  audioPath = null
  $recorder.set(IDLE)

  if (target) {
    // Discarded on purpose, so the partial file goes with it — into the trash,
    // not deleted, in case the press was a mistake.
    await writeChain.catch(() => undefined)
    await window.hermesDesktop.vault.trash(target).catch(() => undefined)
  }
}
