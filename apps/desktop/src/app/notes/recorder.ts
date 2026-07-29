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
}

const IDLE: RecorderState = { status: 'idle', elapsed: 0, error: null, folder: null }

export const $recorder = atom<RecorderState>(IDLE)

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let ticker: ReturnType<typeof setInterval> | null = null
let startedAt = 0

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
          ? 'BISEO needs microphone access. Grant it in System Settings → Privacy & Security → Microphone.'
          : error instanceof Error
            ? error.message
            : 'No microphone available.'
    })

    return false
  }

  const mimeType = pickMimeType()

  chunks = []
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

  recorder.ondataavailable = event => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  // Timeslice: without it a crash mid-meeting loses everything, because the
  // blob is only produced at stop().
  recorder.start(5_000)
  startedAt = Date.now()

  $recorder.set({ status: 'recording', elapsed: 0, error: null, folder: meetingFolder(title, new Date()) })

  ticker = setInterval(() => {
    const current = $recorder.get()

    if (current.status === 'recording') {
      $recorder.set({ ...current, elapsed: Math.floor((Date.now() - startedAt) / 1000) })
    }
  }, 1000)

  return true
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

/** Stop, write the audio into the vault, and return where it landed. */
export async function stopRecording(): Promise<FinishedRecording | null> {
  const current = $recorder.get()

  if (current.status !== 'recording' || !recorder) {
    return null
  }

  const active = recorder
  const folder = current.folder ?? meetingFolder('', new Date())
  const seconds = Math.floor((Date.now() - startedAt) / 1000)

  $recorder.set({ ...current, status: 'saving' })

  const blob = await new Promise<Blob>(resolve => {
    active.onstop = () => resolve(new Blob(chunks, { type: active.mimeType || 'audio/webm' }))
    active.stop()
  })

  teardown()

  const extension = blob.type.includes('mp4') ? 'm4a' : 'webm'
  const audioPath = `${folder}/audio.${extension}`

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())

    if (!bytes.byteLength) {
      $recorder.set({ ...IDLE, status: 'error', error: 'The recording came out empty — nothing was captured.' })

      return null
    }

    await window.hermesDesktop.vault.writeBinary(audioPath, bytes)
  } catch (error) {
    $recorder.set({
      ...IDLE,
      status: 'error',
      error: error instanceof Error ? error.message : 'Could not save the recording.'
    })

    return null
  }

  $recorder.set(IDLE)

  return { audioPath, folder, seconds }
}

/** Abandon a recording without writing it. */
export function cancelRecording(): void {
  if (recorder && $recorder.get().status === 'recording') {
    recorder.onstop = null
    recorder.stop()
  }

  chunks = []
  teardown()
  $recorder.set(IDLE)
}
