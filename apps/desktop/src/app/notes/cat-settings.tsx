import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import type { CatStatus, CatSettings as Settings } from '@/lib/cat-types'

import { $productLocale } from './strings'

const COPY = {
  en: {
    title: 'DAAT Cat', subtitle: 'Choose when the menu bar companion runs and which information it shows.',
    enabled: 'Enable DAAT Cat', autoStart: 'Start when Daat opens', quitWithApp: 'Quit when Daat quits',
    showCpu: 'CPU', showMemory: 'Memory', showStorage: 'Storage', showBattery: 'Battery',
    showNetwork: 'Network', showProgress: 'DAAT task progress', showUsage: 'Codex account usage',
    display: 'Show in the menu bar panel', loading: 'Loading settings…', retry: 'Retry',
    running: 'Running', stopped: 'Stopped', start: 'Start now', stop: 'Stop now',
    missing: 'DAAT Cat is missing from this build. Install the complete Daat app to use it.',
    unsupported: 'DAAT Cat is available on macOS.', profile: 'DAAT profile', folder: 'Data folder',
    usage: 'Account source: ~/.codex/auth.json. Reads the Codex login only when usage is enabled. Renew an expired login in Codex.',
    remote: 'This profile uses a remote connection. View its task progress in Daat.', error: 'Could not update DAAT Cat.'
  },
  ko: {
    title: 'DAAT Cat', subtitle: '메뉴 막대 고양이의 실행 방식과 표시할 정보를 선택하세요.',
    enabled: 'DAAT Cat 사용', autoStart: 'Daat을 열 때 자동 실행', quitWithApp: 'Daat 종료 시 함께 종료',
    showCpu: 'CPU', showMemory: '메모리', showStorage: '저장 공간', showBattery: '배터리',
    showNetwork: '네트워크', showProgress: 'DAAT 작업 진행 상황', showUsage: 'Codex 계정 사용량',
    display: '메뉴 막대 패널에 표시할 정보', loading: '설정을 불러오는 중…', retry: '다시 시도',
    running: '실행 중', stopped: '중지됨', start: '지금 실행', stop: '지금 중지',
    missing: '이 빌드에는 DAAT Cat이 없습니다. 전체 Daat 앱을 설치하면 사용할 수 있습니다.',
    unsupported: 'DAAT Cat은 macOS에서 사용할 수 있습니다.', profile: 'DAAT 프로필', folder: '데이터 폴더',
    usage: '계정 출처: ~/.codex/auth.json. 사용량 표시를 켰을 때만 Codex 로그인을 읽습니다. 만료된 로그인은 Codex에서 갱신하세요.',
    remote: '이 프로필은 원격 연결을 사용합니다. 작업 진행 상황은 Daat에서 확인하세요.', error: 'DAAT Cat을 변경하지 못했습니다.'
  }
}

const DISPLAY: Array<keyof Settings> = ['showCpu', 'showMemory', 'showStorage', 'showBattery', 'showNetwork', 'showProgress', 'showUsage']

export function CatSettings() {
  const locale = useStore($productLocale)
  const copy = COPY[locale]
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<CatStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      if (!window.hermesDesktop?.cat) {throw new Error(copy.unsupported)}
      const [next, state] = await Promise.all([window.hermesDesktop.cat.getSettings(), window.hermesDesktop.cat.getStatus()])
      setSettings(next); setStatus(state); setError('')
    } catch (err) { setError(err instanceof Error ? err.message : copy.error) }
  }, [copy])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = setInterval(() => { void window.hermesDesktop?.cat?.getStatus().then(setStatus).catch(() => undefined) }, 3000)

    return () => clearInterval(timer)
  }, [])

  const change = async (key: keyof Settings, value: boolean) => {
    setBusy(true); setError('')

    try {
      setSettings(await window.hermesDesktop.cat.setSettings({ [key]: value }))
      setStatus(await window.hermesDesktop.cat.getStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.error)
      // A process launch may fail after the preference was persisted.
      const saved = await window.hermesDesktop.cat.getSettings().catch(() => null)

      if (saved) {setSettings(saved)}
    } finally { setBusy(false) }
  }

  const toggle = (key: keyof Settings) => (
    <label className="flex items-center justify-between gap-5 py-2.5 text-sm" key={key}>
      <span>{copy[key]}</span>
      <input checked={settings?.[key] ?? false} className="size-4 accent-current" disabled={busy || !status?.supported || (key !== 'enabled' && !settings?.enabled)}
        onChange={event => void change(key, event.target.checked)} type="checkbox" />
    </label>
  )

  const run = async () => {
    setBusy(true); setError('')

    try {
      if (status?.running) {await window.hermesDesktop.cat.stop()}
      else {await window.hermesDesktop.cat.start()}

      setStatus(await window.hermesDesktop.cat.getStatus())
    } catch (err) { setError(err instanceof Error ? err.message : copy.error) }
    finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="cat-settings-title" className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <div><h2 className="text-xl font-semibold" id="cat-settings-title">{copy.title}</h2><p className="mt-2 text-sm opacity-65">{copy.subtitle}</p></div>
      {(error || status?.error) && <div className="text-sm text-red-600" role="alert">{error || status?.error} <button className="underline" onClick={() => void load()} type="button">{copy.retry}</button></div>}
      {!settings ? <p>{copy.loading}</p> : <>
        {status && !status.supported && <p className="text-sm">{copy.unsupported}</p>}
        {status?.supported && !status.available && <p className="text-sm">{copy.missing}</p>}
        <div>{(['enabled', 'autoStart', 'quitWithApp'] as Array<keyof Settings>).map(toggle)}</div>
        <div className="flex items-center justify-between gap-4"><span className="text-sm" role="status">{status?.running ? copy.running : copy.stopped}</span>
          <button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" disabled={busy || !settings.enabled || !status?.available} onClick={() => void run()} type="button">{status?.running ? copy.stop : copy.start}</button></div>
        <fieldset className="border-t pt-4"><legend className="text-sm font-medium">{copy.display}</legend>{DISPLAY.map(toggle)}</fieldset>
        <div className="space-y-2 break-all text-xs opacity-65"><p>{copy.profile}: {status?.profile || 'default'}</p><p>{copy.folder}: {status?.runtimeHome || '—'}</p>
          {status?.mode === 'remote' && <p>{copy.remote}</p>}<p>{copy.usage}</p></div>
      </>}
    </section>
  )
}
