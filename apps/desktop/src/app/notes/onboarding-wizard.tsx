/**
 * First run. Three questions, none of them about configuration:
 * who you are, where your notes live, and then out of the way.
 *
 * The design intent is Apple-calm rather than SaaS-eager: one question per
 * screen, generous space, no progress gamification, and a visible escape at
 * every step. Everything it sets is editable afterwards, and the copy says
 * so — a first run that promises less is one the user can trust.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { $vaultInfo, chooseVault } from '../vault/store'
import { PERSONAS } from './personas'
import { applyPersona, finishOnboarding } from './persona-store'
import { $productLocale, productStrings, setProductLocale } from './strings'
import { openDailyNote } from './templates'
import type { PersonaId } from './personas'

type Step = 'persona' | 'place' | 'ready'

export function OnboardingWizard() {
  const info = useStore($vaultInfo)
  const locale = useStore($productLocale)
  const s = productStrings(locale)
  const [step, setStep] = useState<Step>('persona')
  const [chosen, setChosen] = useState<PersonaId | null>(null)
  const [applying, setApplying] = useState(false)
  const [seeded, setSeeded] = useState(0)

  // Escape leaves the wizard at any point; a first run you can't skip is a
  // first run that ships with an angry review.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishOnboarding()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const persona = PERSONAS.find(entry => entry.id === chosen) ?? null

  const confirmPersona = async () => {
    if (!chosen) {
      return
    }

    setApplying(true)

    const result = await applyPersona(chosen)

    setSeeded(result.notesCreated)
    setApplying(false)
    setStep('ready')
  }

  return (
    <div className="fixed inset-0 z-(--z-onboarding) flex items-center justify-center bg-(--ui-chat-surface-background) p-6">
      <div
        className="flex w-full max-w-[46rem] flex-col"
        style={{ animation: 'biseo-lift 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both' }}
      >
        {step === 'persona' && (
          <>
            {/* Language sits on the first screen because that is the only
                moment it matters: the OS language is a good guess, not a
                certainty, and a Korean user on an English Mac shouldn't have
                to read English to find this. */}
            <div className="mb-3 flex justify-end gap-1">
              {(['en', 'ko'] as const).map(option => (
                <button
                  key={option}
                  onClick={() => setProductLocale(option)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[12px] transition-colors',
                    locale === option
                      ? 'bg-(--ui-control-hover-background) font-medium'
                      : 'opacity-50 hover:opacity-90'
                  )}
                >
                  {option === 'en' ? 'English' : '한국어'}
                </button>
              ))}
            </div>

            <Heading
              title={s.onboardingQuestion}
              subtitle={s.onboardingSubtitle}
            />

            <div className="grid grid-cols-3 gap-3">
              {PERSONAS.map(entry => {
                const selected = chosen === entry.id

                return (
                  <button
                    key={entry.id}
                    onClick={() => setChosen(entry.id)}
                    onDoubleClick={() => void confirmPersona()}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all duration-150',
                      'hover:-translate-y-px hover:shadow-[0_6px_18px_-10px_rgba(0,0,0,0.35)]',
                      selected
                        ? 'border-(--dt-primary) bg-[color-mix(in_srgb,var(--dt-primary)_7%,transparent)]'
                        : 'border-(--stroke-nous)'
                    )}
                  >
                    <span className="text-[22px] leading-none">{entry.emoji}</span>
                    <span className="mt-1 text-[13.5px] font-semibold">
                      {locale === 'ko' ? entry.ko.name : entry.name}
                    </span>
                    <span className="text-[12.5px] leading-snug opacity-60">
                      {locale === 'ko' ? entry.ko.promise : entry.promise}
                    </span>
                  </button>
                )
              })}
            </div>

            <Actions
              onSkip={finishOnboarding}
              primary={{
                label: s.continue,
                disabled: !chosen,
                onClick: () => setStep('place')
              }}
            />
          </>
        )}

        {step === 'place' && (
          <>
            <Heading
              title={s.notesLiveHere}
              subtitle={s.notesLiveHereSubtitle}
            />

            <div className="rounded-xl border border-(--stroke-nous) p-4">
              <div className="flex items-center gap-2.5">
                <Codicon
                  name={info?.location === 'icloud' ? 'cloud' : 'folder'}
                  className="text-[18px] text-(--dt-primary)"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{info?.root ?? s.noFolderYet}</div>
                  <div className="text-[12px] opacity-55">
                    {info?.location === 'icloud'
                      ? s.inICloud
                      : s.onThisMac}
                  </div>
                </div>
                <button
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-(--ui-control-hover-background)"
                  onClick={() => void chooseVault()}
                >
                  {s.chooseAnother}
                </button>
              </div>
            </div>

            <Actions
              onBack={() => setStep('persona')}
              onSkip={finishOnboarding}
              primary={{
                label: applying ? s.settingUp : s.setUpMyPages,
                disabled: applying,
                onClick: () => void confirmPersona()
              }}
            />
          </>
        )}

        {step === 'ready' && (
          <>
            <Heading
              title={`${s.ready}${persona ? ` · ${locale === 'ko' ? persona.ko.name : persona.name}` : ''}`}
              subtitle={s.readySubtitle(seeded)}
            />

            <div className="flex flex-col gap-2">
              {[
                { key: '⌘N', text: s.newPage },
                { key: '⌘D', text: s.todaysDailyNote },
                { key: '/', text: s.insertBlock },
                { key: '⌘J', text: s.askTheAssistant }
              ].map(row => (
                <div key={row.key} className="flex items-center gap-3 text-[13px]">
                  <kbd className="min-w-[2.4rem] rounded-md bg-(--ui-control-hover-background) px-1.5 py-0.5 text-center text-[12px] opacity-80">
                    {row.key}
                  </kbd>
                  <span className="opacity-70">{row.text}</span>
                </div>
              ))}
            </div>

            <Actions
              primary={{
                label: s.startTodaysPlan,
                onClick: () => {
                  finishOnboarding()
                  void openDailyNote()
                }
              }}
              secondary={{ label: s.justLookAround, onClick: finishOnboarding }}
            />
          </>
        )}
      </div>
    </div>
  )
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-bold tracking-tight">{title}</h1>
      <p className="mt-1.5 max-w-[34rem] text-[13.5px] leading-relaxed opacity-60">{subtitle}</p>
    </div>
  )
}

function Actions({
  primary,
  secondary,
  onBack,
  onSkip
}: {
  primary: { label: string; onClick: () => void; disabled?: boolean }
  secondary?: { label: string; onClick: () => void }
  onBack?: () => void
  onSkip?: () => void
}) {
  const label = productStrings(useStore($productLocale))

  return (
    <div className="mt-7 flex items-center gap-2">
      {onBack ? (
        <button
          className="rounded-lg px-2.5 py-1.5 text-[13px] opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
          onClick={onBack}
        >
          {label.back}
        </button>
      ) : null}

      {onSkip ? (
        <button className="text-[12.5px] opacity-45 transition-opacity hover:opacity-80" onClick={onSkip}>
          {label.skipSetup}
        </button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {secondary ? (
          <button
            className="rounded-lg px-3 py-1.5 text-[13px] opacity-70 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
            onClick={secondary.onClick}
          >
            {secondary.label}
          </button>
        ) : null}
        <button
          className={cn(
            'h-[32px] rounded-lg bg-(--dt-primary) px-4 text-[13px] font-medium text-white transition-opacity',
            'shadow-[0_4px_12px_-5px_rgba(0,122,255,0.7)]',
            primary.disabled ? 'cursor-not-allowed opacity-40' : 'hover:opacity-90'
          )}
          disabled={primary.disabled}
          onClick={primary.onClick}
        >
          {primary.label}
        </button>
      </div>
    </div>
  )
}
