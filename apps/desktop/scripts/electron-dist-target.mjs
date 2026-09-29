// A locally installed Electron belongs to the build host. Let electron-builder
// download its target runtime whenever the CLI asks for another OS or CPU.
export function canReuseHostElectron(argv, platform = process.platform, arch = process.arch) {
  const platforms = {
    '--mac': 'darwin', '--macos': 'darwin', '-m': 'darwin', '-o': 'darwin',
    '--win': 'win32', '--windows': 'win32', '-w': 'win32',
    '--linux': 'linux', '-l': 'linux'
  }
  for (const arg of argv) {
    const flag = arg.split('=')[0]
    // An explicit config may set targets/architectures or provide its own
    // electronDist. Do not second-guess it with a host-runtime override.
    if (/^(?:--config(?:[.=]|$)|-c|--projectDir(?:=|$)|-pd)/.test(arg)) return false
    if (platforms[flag] && platforms[flag] !== platform) return false
    if (/^-[mwlo]{2,}$/.test(flag) && [...flag.slice(1)].some(short => platforms[`-${short}`] !== platform)) return false
    const cpu = /^(?:--)(x64|ia32|arm64|armv7l|universal)(?:=|$)/.exec(arg)?.[1]
      ?? /:(x64|ia32|arm64|armv7l|universal)$/.exec(arg)?.[1]
    if (cpu && cpu !== arch) return false
  }
  return true
}
