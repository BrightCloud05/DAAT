/** Meeting capture stays alive across views; each recording owns a unique file. */
import { atom } from 'nanostores'

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'saving' | 'error'

export interface RecorderState {
  status: RecorderStatus
  elapsed: number
  error: string | null
  folder: string | null
  title?: string
  interrupted?: string | null
}

const IDLE: RecorderState = { status: 'idle', elapsed: 0, error: null, folder: null }
export const $recorder = atom<RecorderState>(IDLE)

interface Capture {
  recorder: MediaRecorder
  stream: MediaStream
  title: string
  folder: string
  audioPath: string
  vaultRoot: string
  startedAt: number
  endedAt?: number
  ticker?: ReturnType<typeof setInterval>
  chain: Promise<void>
  bytes: number
  error: string | null
  discarded: boolean
}

let capture: Capture | null = null
let requestGeneration = 0

/** Human-readable date/title plus an identity independent of clock precision. */
export function meetingFolder(title: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`

  const safe = title
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

  return `Meetings/${stamp}${safe ? ` ${safe}` : ''} ${crypto.randomUUID()}`
}

function pickMimeType(): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported?.(type))
}

export function formatElapsed(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function release(current: Capture): void {
  if (current.ticker) {clearInterval(current.ticker)}
  current.stream.getTracks().forEach(track => track.stop())

  if (capture === current) {capture = null}
}

function interrupt(current: Capture, reason: string): void {
  if (capture !== current || current.endedAt !== undefined) {return}
  current.endedAt = Date.now()
  $recorder.set({
    ...$recorder.get(),
    elapsed: Math.floor((current.endedAt - current.startedAt) / 1000),
    interrupted: reason
  })
}

export async function startRecording(title: string): Promise<boolean> {
  if (!['idle', 'error'].includes($recorder.get().status)) {return false}
  const generation = ++requestGeneration
  $recorder.set({ ...IDLE, title, status: 'requesting' })
  let stream: MediaStream | null = null

  try {
    const vaultRoot = (await window.hermesDesktop.vault.info()).root

    if (!vaultRoot) {throw new Error('Choose a notes folder before recording.')}

    if (generation !== requestGeneration) {return false}
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })

    if (generation !== requestGeneration) {
      stream.getTracks().forEach(track => track.stop())

      return false
    }

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const folder = meetingFolder(title, new Date())

    const current: Capture = {
      recorder,
      stream,
      folder,
      title,
      vaultRoot,
      audioPath: `${folder}/audio.${(mimeType ?? recorder.mimeType).includes('mp4') ? 'm4a' : 'webm'}`,
      startedAt: Date.now(),
      chain: Promise.resolve(),
      bytes: 0,
      error: null,
      discarded: false
    }

    capture = current

    recorder.ondataavailable = event => {
      if (!event.data.size || current.discarded) {return}
      const chunk = event.data
      current.chain = current.chain.then(async () => {
        try {
          const result = await window.hermesDesktop.vault.appendBinary(
            current.audioPath,
            new Uint8Array(await chunk.arrayBuffer()),
            current.vaultRoot
          )

          current.bytes = result.bytes
        } catch (error) {
          current.error ??= error instanceof Error ? error.message : 'Could not save the recording.'

          if (capture === current) {$recorder.set({ ...$recorder.get(), error: current.error })}
        }
      })
    }

    recorder.onerror = () => interrupt(current, 'The microphone stopped working.')

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => interrupt(current, 'The microphone was disconnected.'))
    }

    recorder.start(5_000)
    $recorder.set({ status: 'recording', title, folder, elapsed: 0, error: null, interrupted: null })
    current.ticker = setInterval(() => {
      if (capture === current && current.endedAt === undefined && $recorder.get().status === 'recording') {
        $recorder.set({ ...$recorder.get(), elapsed: Math.floor((Date.now() - current.startedAt) / 1000) })
      }
    }, 1000)

    return true
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop())

    if (generation === requestGeneration) {
      if (capture) {release(capture)}
      $recorder.set({
        ...IDLE,
        status: 'error',
        error:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Daat needs microphone access. Grant it in System Settings → Privacy & Security → Microphone.'
            : error instanceof Error
              ? error.message
              : 'Could not start a recording.'
      })
    }

    return false
  }
}

async function stopCapture(current: Capture): Promise<void> {
  if (current.recorder.state !== 'inactive') {
    await new Promise<void>((resolve, reject) => {
      current.recorder.onstop = () => resolve()

      try {
        current.recorder.stop()
      } catch (error) {
        reject(error)
      }
    })
  }

  // MediaRecorder flushes its final data event before stop. The same capture's
  // serialized chain must finish before its file can be used or discarded.
  await current.chain
}

export interface FinishedRecording {
  audioPath: string
  folder: string
  seconds: number
  title: string
  vaultRoot: string
  startedAt: number
}

export async function stopRecording(): Promise<FinishedRecording | null> {
  const current = capture

  if (!current || $recorder.get().status !== 'recording') {return null}
  $recorder.set({ ...$recorder.get(), status: 'saving' })

  try {
    await stopCapture(current)
  } catch (error) {
    current.error ??= error instanceof Error ? error.message : 'Could not finish the recording.'
  }

  release(current)

  if (current.error) {
    $recorder.set({
      ...IDLE,
      status: 'error',
      error: `${current.error} The audio so far is at ${current.vaultRoot}/${current.audioPath}.`
    })

    return null
  }

  if (!current.bytes) {
    await window.hermesDesktop.vault.trash(current.audioPath, current.vaultRoot).catch(() => undefined)
    $recorder.set({ ...IDLE, status: 'error', error: 'The recording came out empty — nothing was captured.' })

    return null
  }

  $recorder.set(IDLE)

  return {
    audioPath: current.audioPath,
    folder: current.folder,
    title: current.title,
    vaultRoot: current.vaultRoot,
    startedAt: current.startedAt,
    seconds: Math.floor(((current.endedAt ?? Date.now()) - current.startedAt) / 1000)
  }
}

export async function cancelRecording(): Promise<void> {
  ++requestGeneration
  const current = capture

  if (!current) {
    $recorder.set(IDLE)

    return
  }

  if ($recorder.get().status === 'saving') {return}
  current.discarded = true
  $recorder.set({ ...$recorder.get(), status: 'saving' })

  try {
    await stopCapture(current)
    await window.hermesDesktop.vault.trash(current.audioPath, current.vaultRoot)
    $recorder.set(IDLE)
  } catch (error) {
    $recorder.set({
      ...IDLE,
      status: 'error',
      error: `${error instanceof Error ? error.message : 'Could not discard the recording.'} ${current.vaultRoot}/${current.audioPath}`
    })
  } finally {
    release(current)
  }
}
