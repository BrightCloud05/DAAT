/**
 * stage-daatcat.mjs — bundles the DAAT Cat menu bar helper into Daat.app.
 *
 * DAAT Cat is a small native Swift app (apps/daatcat) that lives in the
 * macOS menu bar: a RunCat-style cat whose pace tracks system load, with a
 * panel showing system stats, agent credit usage and DAAT 진행사항. Shipping
 * it inside Daat.app makes it a default feature instead of a separate
 * install — the electron main process launches it on boot (see main.ts).
 *
 * Darwin-only and best-effort by design: a missing Swift toolchain or a
 * failed helper build must never fail the desktop build. Linux/Windows
 * packs and CI machines without Xcode CLT just skip it with a warning.
 *
 * NOTE for a future notarized release: the helper is ad-hoc signed here.
 * A Developer ID build must re-sign `Contents/Resources/DAAT Cat.app` with
 * the same identity before notarization, or notarytool will reject the
 * nested bundle.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'

export function stageDaatCat(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const desktopRoot = path.resolve(import.meta.dirname, '..')
  const daatcatRoot = path.resolve(desktopRoot, '..', 'daatcat')
  const builtApp = path.join(daatcatRoot, 'dist', 'DAAT Cat.app')

  if (!existsSync(path.join(daatcatRoot, 'Package.swift'))) {
    console.warn('[stage-daatcat] apps/daatcat not found; Daat ships without the menu bar cat')
    return
  }

  try {
    execFileSync('swift', ['--version'], { stdio: 'ignore' })
  } catch {
    console.warn('[stage-daatcat] no Swift toolchain; Daat ships without the menu bar cat')
    return
  }

  try {
    execFileSync('/bin/zsh', [path.join(daatcatRoot, 'build-app.sh')], {
      cwd: daatcatRoot,
      stdio: 'inherit'
    })
  } catch (err) {
    console.warn(`[stage-daatcat] helper build failed (${err.message}); Daat ships without the menu bar cat`)
    return
  }

  const productName = context.packager?.appInfo?.productFilename || 'Daat'
  const resources = path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources')
  const target = path.join(resources, 'DAAT Cat.app')

  try {
    rmSync(target, { recursive: true, force: true })
    cpSync(builtApp, target, { recursive: true })
    console.log(`[stage-daatcat] bundled DAAT Cat.app into ${productName}.app`)
  } catch (err) {
    console.warn(`[stage-daatcat] could not copy helper into the bundle (${err.message})`)
  }
}
