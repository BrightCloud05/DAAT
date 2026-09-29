import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { refreshAgentSource } from './agent-source'

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd, env, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, error => {
      if (error) {reject(new Error(`Runtime verification failed (${path.basename(command)}): ${error.message}`))}
      else {resolve()}
    })

    child.stdout?.on('data', chunk => log(String(chunk).trim()))
    child.stderr?.on('data', chunk => log(String(chunk).trim()))
  })
}

/** Install into the final path so venv launchers never retain a staging path. */
export async function refreshBundledRuntime(installed: string, bundle: string, hermesHome: string, log: (line: string) => void) {
  return refreshAgentSource(installed, bundle, {
    copy: (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) },
    remove: target => fs.rmSync(target, { force: true }),
    exists: fs.existsSync,
    prepareRuntime: async ({ previous, depsChanged }) => {
      const validationHome = fs.mkdtempSync(path.join(os.tmpdir(), 'daat-runtime-check-'))
      const bin = process.platform === 'win32' ? 'Scripts' : 'bin'
      const pythonName = process.platform === 'win32' ? 'python.exe' : 'python'
      const env = { ...process.env, HERMES_HOME: validationHome, PYTHONPATH: installed, UV_PROJECT_ENVIRONMENT: path.join(installed, 'venv') }

      try {
        if (depsChanged) {
          const managedUv = path.join(hermesHome, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
          const uv = fs.existsSync(managedUv) ? managedUv : 'uv'
          const previousPython = path.join(previous, 'venv', bin, pythonName)
          log('Preparing the updated agent environment…')
          await run(uv, ['sync', '--locked', '--extra', 'all', '--project', installed, '--python', previousPython], installed, env, log)
        }

        const python = path.join(installed, 'venv', bin, pythonName)
        await run(python, ['-c', 'import run_agent, hermes_cli.main, tui_gateway.server, tools.registry'], installed, env, log)
        await run(python, ['-m', 'hermes_cli.main', 'serve', '--help'], installed, env, log)
      } finally {
        fs.rmSync(validationHome, { recursive: true, force: true })
      }
    }
  })
}
