export interface CatSettings {
  enabled: boolean
  autoStart: boolean
  quitWithApp: boolean
  showCpu: boolean
  showMemory: boolean
  showStorage: boolean
  showBattery: boolean
  showNetwork: boolean
  showProgress: boolean
  showUsage: boolean
}
export interface CatContext { runtimeHome: string; profile: string; mode: 'local' | 'remote'; applicationPath: string }
export const DEFAULT_CAT_SETTINGS: CatSettings = {
  enabled: true, autoStart: true, quitWithApp: false,
  showCpu: true, showMemory: true, showStorage: true, showBattery: true,
  showNetwork: true, showProgress: true, showUsage: false
}

export function sanitizeCatSettings(value: unknown, base: CatSettings = DEFAULT_CAT_SETTINGS): CatSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result = { ...base }

  for (const key of Object.keys(base) as Array<keyof CatSettings>) {
    if (typeof input[key] === 'boolean') {result[key] = input[key]}
  }

  return result
}
