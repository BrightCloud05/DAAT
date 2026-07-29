import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import type { Locale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

export const TRANSLATIONS: Record<Locale, Translations> = {
  en,
  zh,
  'zh-hant': zhHant,
  ja,
  ar,
  // Korean maps to the English catalogue on purpose. BISEO's own screens —
  // the ones a buyer actually reads — are translated in
  // src/app/notes/strings.ts; this 2,900-line inherited Hermes catalogue is
  // not, and showing English there is honest. The runtime's per-key fallback
  // means translating it later is incremental, not all-or-nothing.
  ko: en
}
