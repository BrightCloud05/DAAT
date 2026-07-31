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

import { applyPersona, finishOnboarding } from './persona-store'
import { PERSONAS } from './personas'
import type { PersonaId } from './personas'
import { endSetup } from './setup-agent'
import { SetupChat } from './setup-chat'
import { $productLocale, productStrings } from './strings'

type Step = 'persona' | 'place' | 'setup'

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
    setStep('setup')
  }

  return (
    <div className="fixed inset-0 z-(--z-onboarding) flex items-center justify-center bg-(--theme-neutral-chrome) backdrop-blur-xl p-6">
      <div
        className="flex w-full max-w-[46rem] flex-col"
        style={{ animation: 'daat-lift 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both' }}
      >
        {step === 'persona' && (
          <>
            <Heading
              subtitle={s.onboardingSubtitle}
              title={s.onboardingQuestion}
            />

            <div className="grid grid-cols-3 gap-3">
              {PERSONAS.map(entry => {
                const selected = chosen === entry.id

                return (
                  <button
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all duration-150',
                      'hover:-translate-y-px hover:shadow-[0_6px_18px_-10px_rgba(0,0,0,0.35)]',
                      selected
                        ? 'border-(--dt-primary) bg-[color-mix(in_srgb,var(--dt-primary)_7%,transparent)]'
                        : 'border-(--stroke-nous)'
                    )}
                    key={entry.id}
                    onClick={() => setChosen(entry.id)}
                    onDoubleClick={() => void confirmPersona()}
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
              subtitle={s.notesLiveHereSubtitle}
              title={s.notesLiveHere}
            />

            <div className="rounded-xl border border-(--stroke-nous) p-4">
              <div className="flex items-center gap-2.5">
                <Codicon
                  className="text-[18px] text-(--dt-primary)"
                  name={info?.location === 'icloud' ? 'cloud' : 'folder'}
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

        {/* The assistant takes it from here: it opens the conversation and
            builds the user's pages as they answer. */}
        {step === 'setup' && persona ? (
          <SetupChat
            onDone={() => {
              void endSetup()
              finishOnboarding()
            }}
            persona={persona}
          />
        ) : null}
      </div>
    </div>
  )
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-(--dt-font-serif) font-medium tracking-[-0.01em]">{title}</h1>
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
            'h-[32px] rounded-xs bg-(--dt-primary) px-4 text-[13px] font-medium text-(--dt-primary-foreground) transition-opacity',
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
