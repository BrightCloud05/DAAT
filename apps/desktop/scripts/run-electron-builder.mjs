// Resolve electronDist at runtime (#38673, #47917): electron-builder 26.8.x can
// re-unpack a broken Electron.app; reusing the installed dist dodges that.
// npm workspace hoisting is non-deterministic — require.resolve finds electron
// wherever it landed. Dist present → -c.electronDist=<abs>/dist; absent → let
// electron-builder fetch via @electron/get (electronVersion + ELECTRON_MIRROR).

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

function electronDistDir() {
  try {
    return path.join(path.dirname(require.resolve("electron/package.json")), "dist")
  } catch {
    return null
  }
}

function distBinary(dist) {
  if (process.platform === "darwin") {
    return path.join(dist, "Electron.app", "Contents", "MacOS", "Electron")
  }
  if (process.platform === "win32") {
    return path.join(dist, "electron.exe")
  }
  return path.join(dist, "electron")
}

function electronBuilderCli() {
  const pkgJson = require.resolve("electron-builder/package.json")
  const bin = require(pkgJson).bin
  const rel = typeof bin === "string" ? bin : bin["electron-builder"]
  return path.join(path.dirname(pkgJson), rel)
}

const dist = electronDistDir()
const args = []
if (dist && fs.existsSync(distBinary(dist))) {
  args.push(`-c.electronDist=${dist}`)
} else {
  console.warn(
    "[run-electron-builder] no local electron dist; electron-builder will fetch " +
      "via @electron/get (electronVersion + ELECTRON_MIRROR)."
  )
}
// ── Ad-hoc signing for deliberately unsigned builds ────────────────────────
// electron-builder used to fall back to an ad-hoc signature when it found no
// certificate; it stopped doing that in 26.x (PR #9822, June 2026) and now
// skips signing entirely. The result is an .app with no _CodeSignature at all,
// and macOS treats "no signature" very differently from "ad-hoc signature":
//
//   ad-hoc          → "unverified developer", and the user CAN open it from
//                     System Settings › Privacy & Security.
//   none / broken   → "…is damaged and can't be opened. Move it to the Trash."
//                     No Open Anyway button, and `xattr -dr` does not rescue it.
//
// On Apple silicon the kernel also refuses to run unsigned arm64 code at all.
//
// So when the build has explicitly opted out of real signing, ask for an ad-hoc
// signature rather than none. This is set here rather than as `mac.identity` in
// package.json on purpose: hard-coding "-" there would keep signing ad-hoc even
// once a real Developer ID certificate exists.
const unsignedMac =
  process.platform === "darwin" &&
  process.env.ALLOW_UNSIGNED === "1" &&
  !process.argv.slice(2).some(arg => arg.startsWith("-c.mac.identity"))

if (unsignedMac) {
  console.warn(
    "[run-electron-builder] ALLOW_UNSIGNED=1 — signing ad-hoc (-c.mac.identity=-). " +
      "Gatekeeper still refuses this on other Macs, but the app is at least openable " +
      "via System Settings instead of being reported as damaged."
  )
  args.push("-c.mac.identity=-")
}

args.push(...process.argv.slice(2))

const result = spawnSync(process.execPath, [electronBuilderCli(), ...args], {
  stdio: "inherit",
})
if (result.error) {
  console.error(`[run-electron-builder] spawn failed: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status == null ? 1 : result.status)
