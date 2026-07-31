/**
 * What the home screen says first thing in the morning.
 *
 * It used to say "You have 17 pages, 0 open tasks" — which is a fact about the
 * database, not about the day. Nobody opens an app wondering how many files
 * they own, and a count that only ever goes up carries no information: it reads
 * the same on the day something is overdue as on the day nothing is.
 *
 * So this answers the question actually being asked, which is "is there
 * anything I need to deal with?" — and it leads with the most urgent true
 * thing, because a briefing that buries the overdue item under a tally is worse
 * than no briefing.
 *
 * When there is nothing pressing it says so plainly rather than manufacturing
 * urgency. "Nothing is due" is a good morning, and the app should be willing
 * to tell you that.
 */

export interface BriefingTask {
  label: string
  due?: string
  done: boolean
}

export interface BriefingInput {
  /** Today, as YYYY-MM-DD. Passed in so this stays pure and testable. */
  today: string
  tasks: readonly BriefingTask[]
  /** Whether today's daily note already exists. */
  hasDaily: boolean
  /** Most-recently-edited real page, for the "where you left off" fallback. */
  lastEdited?: string
  /** Total pages — used only to detect an empty vault. */
  pageCount: number
}

export type BriefingTone = 'late' | 'today' | 'soon' | 'calm' | 'empty'

export interface Briefing {
  tone: BriefingTone
  /** The sentence, with `**bold**` marking the part that carries the weight. */
  text: string
}

/** Whole days from `today` to `due`; negative when overdue. */
export function daysUntil(today: string, due: string): number {
  const a = Date.parse(`${today}T00:00:00`)
  const b = Date.parse(`${due}T00:00:00`)

  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.POSITIVE_INFINITY
  }

  return Math.round((b - a) / 86_400_000)
}

/** How far ahead something still counts as worth mentioning. */
const SOON_DAYS = 3

export function buildBriefing(input: BriefingInput, ko: boolean): Briefing {
  const { today, hasDaily, lastEdited, pageCount } = input

  if (!pageCount) {
    return {
      tone: 'empty',
      text: ko
        ? '아직 아무것도 없습니다. 첫 페이지를 만들면 여기서 하루를 정리해 드릴게요.'
        : "Nothing here yet. Make a first page and I'll keep the day together here."
    }
  }

  const open = input.tasks.filter(task => !task.done)
  const dated = open
    .filter(task => task.due)
    .map(task => ({ task, days: daysUntil(today, task.due as string) }))
    .filter(entry => Number.isFinite(entry.days))
    .sort((a, b) => a.days - b.days)

  const late = dated.filter(entry => entry.days < 0)
  const dueToday = dated.filter(entry => entry.days === 0)
  const soon = dated.filter(entry => entry.days > 0 && entry.days <= SOON_DAYS)

  // Overdue first, always. This is the one thing that cannot wait for scrolling.
  if (late.length) {
    const oldest = late[0]
    const behind = Math.abs(oldest.days)

    if (late.length === 1) {
      return {
        tone: 'late',
        text: ko
          ? `**${oldest.task.label}** 이(가) ${behind}일 지났습니다.`
          : `**${oldest.task.label}** is ${behind} ${behind === 1 ? 'day' : 'days'} overdue.`
      }
    }

    return {
      tone: 'late',
      text: ko
        ? `**${late.length}개가 기한을 넘겼습니다** — 가장 오래된 건 ${oldest.task.label}.`
        : `**${late.length} things are overdue** — the oldest is ${oldest.task.label}.`
    }
  }

  if (dueToday.length) {
    if (dueToday.length === 1) {
      return {
        tone: 'today',
        text: ko
          ? `오늘 **${dueToday[0].task.label}** 마감입니다.`
          : `**${dueToday[0].task.label}** is due today.`
      }
    }

    return {
      tone: 'today',
      text: ko
        ? `오늘 **${dueToday.length}개**가 마감입니다 — ${dueToday[0].task.label} 외.`
        : `**${dueToday.length} things** are due today, starting with ${dueToday[0].task.label}.`
    }
  }

  if (soon.length) {
    const next = soon[0]

    return {
      tone: 'soon',
      text: ko
        ? `**${next.task.label}** 까지 ${next.days}일 남았습니다.`
        : `**${next.task.label}** is due in ${next.days} ${next.days === 1 ? 'day' : 'days'}.`
    }
  }

  // Nothing is pressing. Say that, and offer the thread they were on.
  if (lastEdited) {
    return {
      tone: 'calm',
      text: ko
        ? `마감은 없습니다. **${lastEdited}** 에서 멈춰 있었어요.`
        : `Nothing is due. You left off in **${lastEdited}**.`
    }
  }

  return {
    tone: 'calm',
    text: hasDaily
      ? ko
        ? '마감은 없습니다. 오늘 페이지는 준비돼 있어요.'
        : "Nothing is due. Today's page is ready when you are."
      : ko
        ? '마감은 없습니다. 오늘 페이지부터 시작해 보세요.'
        : 'Nothing is due. Start with today’s page.'
  }
}

/** Split a briefing on its `**bold**` marks, for rendering. */
export function briefingParts(text: string): Array<{ text: string; strong: boolean }> {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map(part =>
      part.startsWith('**') && part.endsWith('**')
        ? { text: part.slice(2, -2), strong: true }
        : { text: part, strong: false }
    )
}
