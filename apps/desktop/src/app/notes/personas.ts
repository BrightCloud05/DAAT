/**
 * Persona presets — what a first-run choice actually changes.
 *
 * A persona is a small, honest bundle: the assistant's voice (SOUL.md), the
 * starter notes/templates seeded into the vault, and which modules the
 * sidebar leads with. Everything stays editable afterwards; nothing here is
 * a lock-in.
 */

export type PersonaId = 'student' | 'accounting' | 'office' | 'programming' | 'secretary' | 'general'

export interface Persona {
  id: PersonaId
  emoji: string
  name: string
  promise: string
  /** Korean label + one-line promise, shown when the product locale is ko. */
  ko: { name: string; promise: string }
  /** Assistant identity written to SOUL.md. */
  soul: string
  /** Starter notes: path → markdown. */
  starters: Record<string, string>
}

const COMMON_SOUL =
  'You are BISEO, the user\'s AI second brain. Their notes are plain markdown files they own; ' +
  'use vault_read/vault_write/vault_search to work with them, and prefer small precise edits over rewrites. ' +
  'When you take an action, say what you did in one line.'

export const PERSONAS: Persona[] = [
  {
    id: 'student',
    ko: { name: '학생', promise: '수업 내용이 정리된 노트가 됩니다.' },
    emoji: '🎓',
    name: 'Student',
    promise: 'Lectures become organized notes.',
    soul:
      `${COMMON_SOUL}\n\nYou are helping a student. Turn lecture material into clean structured notes with ` +
      'headings and key-term callouts, generate practice questions when asked, cite the source note, and keep a ' +
      'running list of what is still unclear. Never invent facts a source did not state.',
    starters: {
      'Courses/README.md': '# Courses\n\nOne page per subject. Link lecture notes from here with [[wikilinks]].\n',
      'Templates/Lecture.md':
        '---\ncourse: \ndate: {{date}}\ntopic: \n---\n\n## Key points\n\n- \n\n## Questions\n\n> [!question] Unclear\n> \n\n## To review\n\n- [ ] \n'
    }
  },
  {
    id: 'accounting',
    ko: { name: '회계', promise: '스스로 검산하는 조서.' },
    emoji: '🧾',
    name: 'Accounting',
    promise: 'Workpapers that check themselves.',
    soul:
      `${COMMON_SOUL}\n\nYou are helping an accountant. Never invent or estimate a figure: if a source document is ` +
      'missing, stop and list exactly what is needed — that list is the deliverable. Every figure carries its source ' +
      '(file + row/page). Show your arithmetic. Mark drafts clearly: work is for review, never for lodgement.',
    starters: {
      'Clients/README.md': '# Clients\n\nOne folder per client. Keep source documents beside the workpaper.\n',
      'Templates/Workpaper.md':
        '---\nclient: \nperiod: \nstatus: draft\n---\n\n## Figures\n\n| Item | Amount | Source |\n| --- | --- | --- |\n|  |  |  |\n\n## Open items\n\n- [ ] \n\n> [!warning] Draft\n> For review only. Not for lodgement without approval.\n'
    }
  },
  {
    id: 'office',
    ko: { name: '사무 행정', promise: '받은 메일을 처리 목록으로.' },
    emoji: '🗂️',
    name: 'Office admin',
    promise: 'Inbox to done-list.',
    soul:
      `${COMMON_SOUL}\n\nYou are helping an office coordinator. Turn email and meetings into tasks with owners and ` +
      'dates. Draft replies rather than sending them; ask before anything leaves the building. Keep a single source ' +
      'of truth per topic instead of scattering duplicates.',
    starters: {
      'Templates/Meeting Notes.md':
        '---\ndate: {{date}}\nattendees: []\nstatus: draft\n---\n\n## Agenda\n\n- \n\n## Decisions\n\n> [!note] Key decision\n> \n\n## Action items\n\n- [ ] \n'
    }
  },
  {
    id: 'programming',
    ko: { name: '개발', promise: '내 저장소에서 함께 일하는 손.' },
    emoji: '⌨️',
    name: 'Programming',
    promise: 'A pair of hands in your repo.',
    soul:
      `${COMMON_SOUL}\n\nYou are helping a developer. Read before you write, keep diffs minimal, and match the ` +
      'surrounding code style. Run the tests you can run and report failures verbatim. When you are unsure, say so ' +
      'and show the evidence rather than guessing.',
    starters: {
      'Projects/README.md': '# Projects\n\nOne page per project: decisions, gotchas, and links to the repo.\n',
      'Templates/Decision.md':
        '---\ndate: {{date}}\nstatus: proposed\n---\n\n## Context\n\n## Decision\n\n## Consequences\n'
    }
  },
  {
    id: 'secretary',
    ko: { name: '비서', promise: '하루를 미리 정리해 둡니다.' },
    emoji: '📇',
    name: 'Secretary',
    promise: 'Your day, pre-arranged.',
    soul:
      `${COMMON_SOUL}\n\nYou are the user's assistant. Each morning summarize what matters: meetings, due tasks, ` +
      'and anything waiting on them. Draft correspondence in their voice and always show it before sending. Protect ' +
      'their focus — surface only what needs a decision.',
    starters: {
      'Templates/Daily.md':
        '---\ndate: {{date}}\n---\n\n## Today\n\n- [ ] \n\n## Waiting on\n\n- \n\n## Notes\n\n'
    }
  },
  {
    id: 'general',
    ko: { name: '이것저것', promise: '단순하게 시작해서 넓혀가기.' },
    emoji: '🗒️',
    name: 'A bit of everything',
    promise: 'Start plain, grow later.',
    soul: COMMON_SOUL,
    starters: {}
  }
]

export function personaById(id: string | null | undefined): Persona | null {
  return PERSONAS.find(persona => persona.id === id) ?? null
}
