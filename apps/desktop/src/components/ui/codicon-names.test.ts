/**
 * Every `<Codicon name="…">` in the app must name an icon that actually
 * exists in the bundled font.
 *
 * A wrong name fails silently: the glyph simply doesn't render and you get an
 * empty box the same colour as the background. That is exactly how the Money
 * row shipped without an icon while every sibling had one (`symbol-currency`,
 * which is not a codicon), and how the composer's mute button rendered as
 * nothing at all in its muted state (`mic-off`) — the one state where you most
 * need to see what it is.
 *
 * Neither was caught by typecheck, tests, or looking at the screen, because
 * "no icon" reads as a spacing choice rather than a bug.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const CODICON_CSS = path.resolve(ROOT, '../../../node_modules/@vscode/codicons/dist/codicon.css')

function validNames(): Set<string> {
  const css = fs.readFileSync(CODICON_CSS, 'utf8')

  return new Set([...css.matchAll(/\.codicon-([a-z0-9-]+):/g)].map(match => match[1]))
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return sourceFiles(full)
    }

    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

/** Literal names, plus both branches of `name={cond ? 'a' : 'b'}`. */
function usedNames(source: string): string[] {
  const literal = [...source.matchAll(/<Codicon\b[^>]*?\bname=["']([a-z0-9-]+)["']/gs)].map(m => m[1])
  const ternary = [...source.matchAll(/<Codicon\b[^>]*?\bname=\{\s*[^?{}]*\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'\s*\}/gs)]
    .flatMap(m => [m[1], m[2]])

  return [...literal, ...ternary]
}

test('the codicon font is where the check expects it', () => {
  assert.ok(fs.existsSync(CODICON_CSS), `codicon.css not found at ${CODICON_CSS}`)
  assert.ok(validNames().size > 400, 'parsed suspiciously few icon names')
})

test('every Codicon name in the app exists in the font', () => {
  const valid = validNames()
  const broken: string[] = []

  for (const file of sourceFiles(path.join(ROOT, 'app'))
    .concat(sourceFiles(path.join(ROOT, 'components')))) {
    const source = fs.readFileSync(file, 'utf8')

    for (const name of usedNames(source)) {
      if (!valid.has(name)) {
        broken.push(`${path.relative(ROOT, file)} → "${name}"`)
      }
    }
  }

  assert.deepEqual(broken, [], `these render as an empty box:\n  ${broken.join('\n  ')}`)
})
