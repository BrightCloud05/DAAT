/**
 * Strings for Daat's own screens (notes, home, todo, calendar, money, mail,
 * first run).
 *
 * Deliberately separate from `src/i18n/*`: that catalogue is ~2,900 lines of
 * inherited Hermes UI, and adding a locale there means translating all of it
 * before a single Daat screen changes language. These screens are ours, they
 * are what a buyer actually reads, and keeping them here also keeps upstream
 * merges from fighting over one enormous file.
 *
 * The language is the app's one language setting (Settings → Appearance →
 * Language), not a second switch to find. English is the default; anything
 * untranslated falls back to English rather than rendering a key.
 */

import { atom } from 'nanostores'

import type { Locale } from '@/i18n/types'

export type ProductLocale = 'en' | 'ko'

/**
 * Mirrors the app locale, narrowed to what this catalogue has.
 *
 * Kept as its own atom rather than reading the I18nProvider directly so
 * non-React callers (the recorder, stores) can read it too. `syncProductLocale`
 * is called by the provider whenever the user changes language.
 */
export const $productLocale = atom<ProductLocale>('en')

export function syncProductLocale(locale: Locale): void {
  $productLocale.set(locale === 'ko' ? 'ko' : 'en')
}

const EN = {
  // Sidebar + shell
  home: 'Home',
  notes: 'Notes',
  todo: 'Todo',
  mail: 'Mail',
  money: 'Money',
  calendar: 'Calendar',
  meetings: 'Meetings',
  comingSoon: 'Coming soon',
  newPage: 'New page',
  settings: 'Settings',
  search: 'Search',

  // Home
  upNext: 'Up next',
  inbox: 'Inbox',
  recentNotes: 'Recent notes',
  today: 'Today',
  openLatest: 'Open latest',
  openTodaysNote: "Open today's note →",
  startTodaysNote: "Start today's note",
  startTodaysPlan: "Start today's plan",
  openTodaysPlan: "Open today's plan",
  nothingScheduled: 'Nothing scheduled. Add a due date and it shows up here.',
  noTasksYet: 'No tasks yet — type "/" → To-do list in any note.',
  noNotesYet: 'Nothing yet — ⌘N creates your first page.',
  inboxEmpty: 'Inbox is empty.',
  connect: 'Connect',
  connectMailHint: 'Connect an account and Daat can read, sort and draft replies.',
  moneyHint: 'Drop a bank statement photo in Money and Daat files the transactions.',
  meetingsHint: 'Record a meeting and Daat transcribes it here and writes up the action items.',
  unreadCount: (count: number) => `${count} unread`,
  openCount: (count: number) => `${count} open`,

  // Editor
  selectANote: 'Select a note, or create one with the + button.',
  startWriting: 'Start writing…',
  unsavedChanges: 'Unsaved changes',
  saved: 'Saved',
  downloadingFromICloud: 'downloading from iCloud…',
  addProperty: 'Add a property',
  propertyName: 'Property name',
  conflictNotice: 'This note changed elsewhere — your edits were saved as a conflict copy.',
  invalidYaml: "This note's properties aren't valid YAML — edit the block at the top of the note to fix it.",
  notAPropertyList: "This note's frontmatter isn't a property list.",
  saveFailed: (reason: string) => `Couldn't save this note — ${reason}. Your text is still here and Daat keeps retrying.`,
  retryNow: 'Retry now',

  // First run
  onboardingQuestion: 'What will you use Daat for?',
  onboardingSubtitle:
    'This sets up a few pages and how the assistant talks to you. You can change it any time.',
  notesLiveHere: 'Your notes live here',
  notesLiveHereSubtitle:
    'Plain markdown files in a folder you own. No database, no lock-in — open them in any editor, back them up however you like.',
  inICloud: 'In iCloud Drive — synced to your other Macs automatically.',
  onThisMac: 'On this Mac.',
  chooseAnother: 'Choose another…',
  noFolderYet: 'No folder chosen yet',
  continue: 'Continue',
  back: 'Back',
  skipSetup: 'Skip setup',
  setUpMyPages: 'Set up my pages',
  settingUp: 'Setting up…',
  justLookAround: 'Just look around',
  ready: 'Ready',
  askTheAssistant: 'Ask the assistant',
  insertBlock: 'Insert a heading, to-do, callout…',
  todaysDailyNote: "Today's daily note",
  readySubtitle: (seeded: number) =>
    (seeded > 0
      ? `${seeded} starter ${seeded === 1 ? 'page is' : 'pages are'} in your sidebar. `
      : '') +
    'Press ⌘J any time to ask the assistant for something — it can read and write your notes, and use your Mac.',

  // Calendar
  openThisDaysNote: "Open this day's note",
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  moreEntries: (count: number) => `+${count} more`,

  // Money
  dropStatement: 'Drop a bank statement here',
  dropStatementHint:
    'A photo, a screenshot or a PDF. Daat reads it, extracts every transaction, shows you the list, and files it into this month’s note. Duplicates are skipped, so re-importing is safe.',
  moneyIn: 'In',
  moneyOut: 'Out',
  moneyNet: 'Net',
  byCategory: 'By category',
  noTransactions: 'No transactions yet for this month.',
  openTheNote: 'Open the note',

  // Meetings
  startRecording: 'Record',
  stopAndSummarize: 'Stop & summarize',
  discard: 'Discard',
  recording: 'Recording…',
  meetingTitlePlaceholder: 'What is this meeting? (optional)',
  recordingHint:
    'Audio is saved into your vault next to the note and transcribed on this Mac — nothing is uploaded. Tell the room you are recording.',
  noMeetingsYet: 'No meetings yet. Record one and Daat writes up the summary and action items.',

  // AI setup conversation
  settingUpTitle: 'Setting up with Daat',
  imDone: "I'm done",
  setupPlaceholder: 'Type your answer…',
  dropAnything: 'You can also drop a timetable, a PDF or a photo anywhere on this window.',
  send: 'Send',
  skipQuestion: 'Skip',
  savedPreference: "Noted — I'll work that way",
  editWithAi: 'Edit with AI',
  newChat: 'New chat',
  recentChats: 'Recent chats',
  untitledChat: 'Untitled chat',
  noChatsYet: 'No conversations yet.',
  graph: 'Graph',
  graphCount: (notes: number, links: number) =>
    `${notes} page${notes === 1 ? '' : 's'} · ${links} link${links === 1 ? '' : 's'}`,
  graphLinkCount: (n: number) => `${n} link${n === 1 ? '' : 's'}`,
  graphRecenter: 'Recentre',
  graphEmptyTitle: 'Nothing linked yet.',
  graphEmptyBody:
    'Type [[ in any page to link to another. Every link you make shows up here as a line between them.',
  emptyEditorTitle: 'Nothing open yet.',
  emptyEditorBody: "Pick a page on the left, or start today's — it's the one most people open first.",
  openTodaysPage: "Open today's page",
  aiRewrote: 'Rewritten by AI.',
  aiWrote: 'Written by AI.',
  aiUndone: 'Put back.',
  // Not `startWriting` — that one is the empty-editor placeholder, and reusing
  // it made this button read "Type here" in Korean.
  openNotes: 'Open my notes',
  setupDoneTitle: "That's your setup done.",
  setupDoneBody:
    'Everything is a plain markdown file in your folder — edit or delete any of it. Press ⌘J any time to ask ' +
    'for something else.',
  undo: 'Undo',
  undone: 'Removed those pages.',
  madePages: (count: number) => `Made ${count} page${count === 1 ? '' : 's'}`,

  // Persona dashboards
  courses: 'Courses',
  assessments: 'Assessments',
  clients: 'Clients',
  projects: 'Projects',
  waitingOn: 'Waiting on',
  courseCount: (count: number) => `${count} enrolled`,
  noCoursesYet: 'No courses yet — make one from the Course template and today\u2019s classes show up here.',
  noClassesToday: 'No classes today.',
  noAssessmentsYet: 'Nothing due — add an Assessment note with a due date and it lands here.',
  noClientsYet: 'No clients yet — make one from the Client template.',
  noProjectsYet: 'No projects yet — make one from the Project template.',
  nothingWaiting: 'Nothing pending on anyone else.',
  dueToday: 'due today',
  inDays: (days: number) => `${days} day${days === 1 ? '' : 's'}`,
  daysLate: (days: number) => `${days} day${days === 1 ? '' : 's'} late`,

  // Mail
  noMailAccount: 'No mail account connected',
  loading: 'Loading…'
}

export type ProductStrings = typeof EN

const KO: Partial<Record<keyof ProductStrings, ProductStrings[keyof ProductStrings]>> = {
  home: '홈',
  notes: '노트',
  todo: '할 일',
  mail: '메일',
  money: '가계부',
  calendar: '캘린더',
  meetings: '회의록',
  comingSoon: '준비 중',
  newPage: '새 페이지',
  settings: '설정',
  search: '검색',

  upNext: '다가오는 일정',
  inbox: '받은 편지함',
  recentNotes: '최근 노트',
  today: '오늘',
  openLatest: '최근 노트 열기',
  openTodaysNote: '오늘 노트 열기 →',
  startTodaysNote: '오늘 노트 시작하기',
  startTodaysPlan: '오늘 할 일 정리하기',
  openTodaysPlan: '오늘 노트 열기',
  nothingScheduled: '예정된 일정이 없습니다. 노트에 날짜를 넣으면 여기에 표시됩니다.',
  noTasksYet: '할 일이 없습니다 — 노트에서 "/" 를 누르고 체크리스트를 넣어보세요.',
  noNotesYet: '아직 노트가 없습니다 — ⌘N 으로 첫 페이지를 만들어 보세요.',
  inboxEmpty: '받은 편지함이 비어 있습니다.',
  connect: '연결하기',
  connectMailHint: '계정을 연결하면 Daat가 메일을 읽고 정리하고 답장 초안까지 써 줍니다.',
  moneyHint: '가계부 화면에 은행 명세서 사진을 올리면 Daat가 거래 내역을 정리합니다.',
  meetingsHint: '회의를 녹음하면 Daat가 텍스트로 옮기고 할 일까지 정리해 줍니다.',
  unreadCount: (count: number) => `읽지 않음 ${count}개`,
  openCount: (count: number) => `${count}개 남음`,

  selectANote: '노트를 선택하거나 + 버튼으로 새로 만들어 보세요.',
  startWriting: '여기에 입력하세요…',
  unsavedChanges: '저장되지 않은 변경사항',
  saved: '저장됨',
  downloadingFromICloud: 'iCloud에서 내려받는 중…',
  addProperty: '속성 추가',
  propertyName: '속성 이름',
  conflictNotice: '이 노트가 다른 곳에서 변경되었습니다 — 수정한 내용은 별도 사본으로 저장했습니다.',
  invalidYaml: '이 노트의 속성이 올바른 YAML이 아닙니다 — 노트 맨 위 블록을 직접 수정해 주세요.',
  notAPropertyList: '이 노트의 머리말은 속성 목록이 아닙니다.',
  saveFailed: (reason: string) =>
    `노트를 저장하지 못했습니다 — ${reason}. 입력한 내용은 그대로 있고 계속 다시 시도합니다.`,
  retryNow: '다시 시도',

  onboardingQuestion: 'Daat를 어떤 일에 사용하시나요?',
  onboardingSubtitle: '선택에 맞춰 몇 개의 페이지와 assistant의 말투를 설정합니다. 나중에 언제든 바꿀 수 있습니다.',
  notesLiveHere: '노트가 저장되는 곳',
  notesLiveHereSubtitle:
    '내 컴퓨터의 폴더에 일반 마크다운 파일로 저장됩니다. 데이터베이스도, 종속도 없습니다 — 다른 편집기로 열 수도, 원하는 방식으로 백업할 수도 있습니다.',
  inICloud: 'iCloud Drive — 다른 Mac에도 자동으로 동기화됩니다.',
  onThisMac: '이 Mac에 저장됩니다.',
  chooseAnother: '다른 폴더 선택…',
  noFolderYet: '아직 폴더를 선택하지 않았습니다',
  continue: '계속',
  back: '뒤로',
  skipSetup: '설정 건너뛰기',
  setUpMyPages: '페이지 만들기',
  settingUp: '설정하는 중…',
  justLookAround: '둘러보기',
  ready: '준비 완료',
  askTheAssistant: 'assistant에게 물어보기',
  insertBlock: '제목, 할 일, 콜아웃 넣기…',
  todaysDailyNote: '오늘의 노트',
  readySubtitle: (seeded: number) =>
    (seeded > 0 ? `사이드바에 시작용 페이지 ${seeded}개를 만들어 두었습니다. ` : '') +
    '언제든 ⌘J 를 눌러 assistant에게 부탁해 보세요 — 노트를 읽고 쓰는 것은 물론 Mac도 직접 조작할 수 있습니다.',

  openThisDaysNote: '이 날의 노트 열기',
  previousMonth: '이전 달',
  nextMonth: '다음 달',
  moreEntries: (count: number) => `+${count}개 더`,

  dropStatement: '은행 명세서를 여기에 올려놓으세요',
  dropStatementHint:
    '사진, 스크린샷, PDF 모두 됩니다. Daat가 읽어서 거래 내역을 뽑아 보여주고 이번 달 노트에 정리합니다. 중복은 건너뛰니 다시 올려도 안전합니다.',
  moneyIn: '수입',
  moneyOut: '지출',
  moneyNet: '합계',
  byCategory: '분류별',
  noTransactions: '이번 달 거래 내역이 없습니다.',
  openTheNote: '노트 열기',

  startRecording: '녹음 시작',
  stopAndSummarize: '중지하고 요약',
  discard: '삭제',
  recording: '녹음 중…',
  meetingTitlePlaceholder: '어떤 회의인가요? (선택)',
  recordingHint:
    '녹음 파일은 노트 옆 볼트에 저장되고 이 Mac에서 바로 텍스트로 변환됩니다 — 외부로 전송되지 않습니다. 참석자에게 녹음 사실을 알려 주세요.',
  noMeetingsYet: '아직 회의록이 없습니다. 녹음하면 Daat가 요약과 할 일을 정리해 줍니다.',

  settingUpTitle: 'Daat와 함께 설정하기',
  imDone: '다 됐어요',
  setupPlaceholder: '답을 입력하세요…',
  dropAnything: '시간표, PDF, 사진을 이 창 아무 데나 끌어다 놓아도 됩니다.',
  send: '보내기',
  skipQuestion: '건너뛰기',
  savedPreference: '알겠습니다 — 그렇게 할게요',
  editWithAi: 'AI로 고치기',
  newChat: '새 대화',
  recentChats: '최근 대화',
  untitledChat: '제목 없는 대화',
  noChatsYet: '아직 대화가 없습니다.',
  graph: '그래프',
  graphCount: (notes: number, links: number) => `페이지 ${notes}개 · 링크 ${links}개`,
  graphLinkCount: (n: number) => `링크 ${n}개`,
  graphRecenter: '가운데로',
  graphEmptyTitle: '아직 이어진 게 없습니다.',
  graphEmptyBody: '아무 페이지에서나 [[ 를 입력하면 다른 페이지로 이어집니다. 이어질 때마다 여기에 선으로 나타납니다.',
  emptyEditorTitle: '아직 열어 둔 게 없습니다.',
  emptyEditorBody: '왼쪽에서 페이지를 고르거나, 오늘 날짜로 시작해 보세요 — 대부분 여기서 시작합니다.',
  openTodaysPage: '오늘 페이지 열기',
  aiRewrote: 'AI가 고쳐 썼습니다.',
  aiWrote: 'AI가 썼습니다.',
  aiUndone: '되돌렸습니다.',
  openNotes: '내 노트 열기',
  setupDoneTitle: '설정이 끝났습니다.',
  setupDoneBody:
    '전부 내 폴더 안의 일반 마크다운 파일입니다 — 수정하거나 지워도 됩니다. 다른 게 필요하면 언제든 ⌘J 를 눌러 주세요.',
  undo: '되돌리기',
  undone: '만든 페이지를 지웠습니다.',
  madePages: (count: number) => `페이지 ${count}개를 만들었어요`,

  courses: '수업',
  assessments: '과제·시험',
  clients: '고객',
  projects: '프로젝트',
  waitingOn: '대기 중',
  courseCount: (count: number) => `${count}과목`,
  noCoursesYet: '아직 수업이 없습니다 — Course 템플릿으로 만들면 오늘 수업이 여기 표시됩니다.',
  noClassesToday: '오늘은 수업이 없습니다.',
  noAssessmentsYet: '마감이 없습니다 — Assessment 노트에 마감일을 넣으면 여기 표시됩니다.',
  noClientsYet: '아직 고객이 없습니다 — Client 템플릿으로 만들어 보세요.',
  noProjectsYet: '아직 프로젝트가 없습니다 — Project 템플릿으로 만들어 보세요.',
  nothingWaiting: '다른 사람에게 기다리는 일이 없습니다.',
  dueToday: '오늘 마감',
  inDays: (days: number) => `${days}일 남음`,
  daysLate: (days: number) => `${days}일 지남`,

  noMailAccount: '연결된 메일 계정이 없습니다',
  loading: '불러오는 중…'
}

const CATALOGUE: Record<ProductLocale, ProductStrings> = {
  en: EN,
  // Spread order matters: anything untranslated falls back to the English
  // string rather than showing a key or an empty label.
  ko: { ...EN, ...KO } as ProductStrings
}

export function productStrings(locale: ProductLocale = $productLocale.get()): ProductStrings {
  return CATALOGUE[locale] ?? EN
}
