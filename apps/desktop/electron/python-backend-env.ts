import fs from 'node:fs'
import path from 'node:path'

import { buildDesktopBackendEnv } from './backend-env'
import { getVenvSitePackagesEntries } from './windows-hermes-path'

/** Interpreter, libraries and PATH must describe the same virtual environment. */
export function buildPythonBackendEnv(root: string, python: string, options: Parameters<typeof buildDesktopBackendEnv>[0] = {}) {
  // Do not realpath Python: a venv's interpreter is commonly a symlink to the
  // shared system binary, but its launch location determines its environment.
  const candidate = path.dirname(path.dirname(python))
  const venvRoot = fs.existsSync(path.join(candidate, 'pyvenv.cfg')) ? candidate : undefined

  return buildDesktopBackendEnv({
    ...options,
    pythonPathEntries: [root, ...getVenvSitePackagesEntries(venvRoot)],
    venvRoot
  })
}
