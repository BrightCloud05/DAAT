/** Renderer view of Electron's persisted helper settings. */
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
export interface CatStatus {
  supported: boolean
  available: boolean
  running: boolean
  error: string | null
  runtimeHome: string
  profile: string
  mode: 'local' | 'remote'
  usageSource: string
}
