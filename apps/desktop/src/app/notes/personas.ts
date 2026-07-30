/**
 * Persona presets — what a first-run choice actually changes.
 *
 * A persona is a small, honest bundle: the assistant's voice (SOUL.md), the
 * agent toolsets it turns on, the starter notes and templates seeded into the
 * vault, and which extra cards the dashboard shows. Everything stays editable
 * afterwards; nothing here is a lock-in.
 *
 * The dashboard cards are lenses over the templates seeded alongside them —
 * a Student gets a Courses card because they also get a Course template that
 * produces the notes it reads. A card with no matching notes says so rather
 * than showing a fake number.
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
  /**
   * Agent toolsets to enable for this persona, on top of the defaults.
   * A student has no business being handed a terminal by default; a
   * programmer wants one on day one.
   */
  toolsets: string[]
  /** Starter notes: path → markdown. */
  starters: Record<string, string>
  /** Extra dashboard cards, rendered after the shared ones. */
  widgets: PersonaWidgetId[]
  /** First-run questions, asked one at a time. */
  questions: SetupQuestion[]
  /**
   * The brief the assistant is given when first-run setup opens.
   *
   * It is a brief, not a script: the assistant writes its own opening line
   * from this, so the conversation sounds like a person rather than a form.
   * The instruction to ask ONE question at a time is the important part —
   * someone who finds AI intimidating will not answer a wall of questions.
   */
  kickoff: string
}

/**
 * One step of first-run setup.
 *
 * `ask` is shown verbatim and never streamed. A first-run question is the
 * same every time, so generating it costs a slow word-by-word reveal of text
 * nobody needed a model to write. The model earns its place on the answer:
 * `instruction` is what it does with what the user typed.
 */
export interface SetupQuestion {
  ask: string
  askKo: string
  hint: string
  hintKo: string
  instruction: string
}

/** Dashboard cards a persona can switch on. */
export type PersonaWidgetId = 'courses' | 'assessments' | 'clients' | 'projects' | 'waitingOn'

const COMMON_KICKOFF =
  '\n\nRules for this conversation: keep every message to two or three short sentences. No bullet lists of questions. Plain words, no jargon — assume they have never used an AI assistant before. Do the work yourself instead of telling them how to do it. If they say they have nothing to hand, that is fine: build what you can from what they type.'

const COMMON_SOUL =
  'You are Daat, the user\'s AI second brain. Their notes are plain markdown files they own; ' +
  'use vault_read/vault_write/vault_search to work with them, and prefer small precise edits over rewrites. ' +
  'When you take an action, say what you did in one line.'

export const PERSONAS: Persona[] = [
  {
    id: 'student',
    questions: [
      {
        ask: 'What are you studying this term?',
        askKo: '이번 학기에 뭘 배우세요?',
        hint: 'Subject names are enough — “linear algebra, stats, two history units”',
        hintKo: '과목 이름만 적어도 됩니다 — “선형대수, 통계, 역사 2과목”',
        instruction:
          'Create one page per subject from Templates/Course.md using vault_write, under Courses/. Fill in code, term, days, time and room only where the user actually said them; leave the rest blank. Do not invent a timetable.'
      },
      {
        ask: 'Anything due soon?',
        askKo: '곧 마감인 게 있나요?',
        hint: 'An assignment, a test, a reading — or skip this',
        hintKo: '과제, 시험, 읽기 — 없으면 건너뛰세요',
        instruction:
          'Create one page per assessment from Templates/Assessment.md using vault_write, under Courses/. Set course, due and weight only where stated. If the user gave no date, leave due blank rather than guessing.'
      },
    ],

    kickoff:
      "The user just told you they are a student and this is the very first thing they see in Daat. Greet them in two short sentences and offer to set up their semester for them. Say plainly what you can work from: a timetable screenshot, a syllabus or course outline PDF, or just the names of their subjects typed out. Then ask ONE question — what subjects they're taking this term. As they answer, create a page per subject from Templates/Course.md with vault_write (fill in code, term, days, time, room when you know them), and a page per assessment from Templates/Assessment.md with its due date. Ask for one missing detail at a time — never a list of questions. When their courses and known deadlines are in, tell them what you made and that it's all on their Home screen now." +
      COMMON_KICKOFF,
    ko: { name: '학생', promise: '수업 내용이 정리된 노트가 됩니다.' },
    emoji: '🎓',
    name: 'Student',
    promise: 'Lectures become organized notes.',
    soul:
      `${COMMON_SOUL}\n\nYou are helping a student. Turn lecture material into clean structured notes with ` +
      'headings and key-term callouts, generate practice questions when asked, cite the source note, and keep a ' +
      'running list of what is still unclear. Never invent facts a source did not state.',
    toolsets: ['vault', 'meetings'],
    widgets: ['courses', 'assessments'],
    starters: {
      'Courses/README.md':
        '# Courses\n\nOne page per subject, made from the Course template — the Home dashboard reads them.\n' +
        'Link lecture notes from each course page with [[wikilinks]].\n',
      'Templates/Course.md':
        '---\ntype: course\ncode: \nterm: \nteacher: \nroom: \n# Days you have this class, e.g. [Mon, Wed]\ndays: []\ntime: \n---\n\n# {{title}}\n\n## Lectures\n\n## Assessments\n\n## Notes to review\n\n- [ ] \n',
      'Templates/Assessment.md':
        '---\ntype: assessment\ncourse: \ndue: \nweight: \nstatus: not started\n---\n\n# {{title}}\n\n## What is being asked\n\n## Plan\n\n- [ ] \n\n## Sources\n\n',
      'Templates/Lecture.md':
        '---\ntype: lecture\ncourse: \ndate: {{date}}\ntopic: \n---\n\n## Key points\n\n- \n\n## Questions\n\n> [!question] Unclear\n> \n\n## To review\n\n- [ ] \n'
    }
  },
  {
    id: 'accounting',
    questions: [
      {
        ask: 'Which clients are you working on?',
        askKo: '지금 어떤 고객 일을 하고 계세요?',
        hint: 'Names are enough',
        hintKo: '이름만 적어도 됩니다',
        instruction:
          'Create one page per client from Templates/Workpaper.md using vault_write, under Clients/. Never invent a figure, a period or an entity number.'
      },
      {
        ask: 'Anything with a deadline?',
        askKo: '마감이 걸린 일이 있나요?',
        hint: 'A lodgement, a review, a year-end — or skip',
        hintKo: '신고, 검토, 결산 — 없으면 건너뛰세요',
        instruction:
          'Add the deadline to the relevant client page with vault_write, or create a page for it if there is no client. Set a due date only if the user gave one.'
      },
    ],

    kickoff:
      "The user just told you they do accounting work and this is the first thing they see in Daat. Greet them in two short sentences and offer to set up their client files. Say what you can work from: a client list, an engagement letter, or just names typed out. Then ask ONE question — which clients they're working on right now. Create a page per client from Templates/Workpaper.md with vault_write as they answer, and ask for one missing detail at a time. Never estimate a figure." +
      COMMON_KICKOFF,
    toolsets: ['vault'],
    widgets: ['clients'] as PersonaWidgetId[],
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
    questions: [
      {
        ask: 'What are you keeping track of this week?',
        askKo: '이번 주에 뭘 챙기고 계세요?',
        hint: 'Meetings, people waiting on you, anything running',
        hintKo: '회의, 답을 기다리는 사람, 진행 중인 일',
        instruction:
          'Create a page per topic with vault_write. Turn anything that reads as a task into a markdown checklist item with an owner where one is named.'
      },
    ],

    kickoff:
      "The user just told you they coordinate an office and this is the first thing they see in Daat. Greet them in two short sentences and offer to set up what they're tracking. Say what you can work from: a meeting agenda, an email thread, or just what's on their plate typed out. Then ask ONE question — what they're responsible for this week. Create pages with vault_write as they answer, one detail at a time." +
      COMMON_KICKOFF,
    toolsets: ['vault', 'mail', 'meetings'],
    widgets: ['waitingOn'] as PersonaWidgetId[],
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
    questions: [
      {
        ask: 'What are you working on?',
        askKo: '지금 뭘 만들고 계세요?',
        hint: 'Project names, or a repo path',
        hintKo: '프로젝트 이름이나 저장소 경로',
        instruction:
          'Create one page per project from Templates/Decision.md using vault_write, under Projects/. If the user gave a repo path, read its README first and summarise what the project is in two sentences.'
      },
    ],

    kickoff:
      "The user just told you they write software and this is the first thing they see in Daat. Greet them in two short sentences and offer to set up their project pages. Say what you can work from: a repo path, a README, or just project names. Then ask ONE question — what they're working on. Create a page per project with vault_write as they answer, one detail at a time." +
      COMMON_KICKOFF,
    toolsets: ['vault', 'hermes-cli'],
    widgets: ['projects'] as PersonaWidgetId[],
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
    questions: [
      {
        ask: 'What do you need to stay on top of?',
        askKo: '무엇을 놓치지 않고 챙겨야 하세요?',
        hint: 'People, commitments, anything recurring',
        hintKo: '사람, 약속, 반복되는 일',
        instruction:
          'Create a page per thing with vault_write. Anything with a date goes in the frontmatter so it reaches the calendar; anything owed by someone else becomes a checklist item saying who.'
      },
    ],

    kickoff:
      "The user just told you they want an assistant for their day, and this is the first thing they see in Daat. Greet them in two short sentences and offer to set up what they're keeping track of. Say what you can work from: a calendar screenshot, a list of people they deal with, or just what's on their plate. Then ask ONE question — what they need to stay on top of this week. Create pages with vault_write as they answer, one detail at a time." +
      COMMON_KICKOFF,
    toolsets: ['vault', 'mail', 'meetings'],
    widgets: ['waitingOn'] as PersonaWidgetId[],
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
    questions: [
      {
        ask: 'What would you like to keep track of?',
        askKo: '무엇을 정리해 두고 싶으세요?',
        hint: 'Anything at all — projects, reading, a plan',
        hintKo: '무엇이든 — 프로젝트, 읽을 것, 계획',
        instruction:
          'Create a page per thing with vault_write, at the top level of the vault. Keep the structure plain.'
      },
    ],

    kickoff:
      "The user just picked a general setup and this is the first thing they see in Daat. Greet them in two short sentences, say you can read documents and photos they give you and turn them into pages, and that you can also use their Mac. Then ask ONE question — what they'd like to keep track of. Create pages with vault_write as they answer, one detail at a time." +
      COMMON_KICKOFF,
    toolsets: ['vault'],
    widgets: [] as PersonaWidgetId[],
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
