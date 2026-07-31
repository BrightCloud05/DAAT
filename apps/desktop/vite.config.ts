import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'

// `hgui` symlinks a worktree's node_modules to the main checkout. Vite realpaths
// those before enforcing server.fs.allow, so codicon/font assets resolve outside
// the worktree root and 404. Whitelist the real node_modules locations.
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const fsAllow = [
  ...new Set(
    [
      path.resolve(__dirname, '../..'),
      real(path.resolve(__dirname, 'node_modules')),
      real(path.resolve(__dirname, '../../node_modules'))
    ].filter((p): p is string => p !== null)
  )
]

// The dev-only render/state churn counters (src/debug) must be imported
// STATICALLY above react-dom — react-dom captures the devtools hook at module
// init, so a dynamic import lands too late and observes zero commits. A static
// side-effect import can't be tree-shaken, so instead the whole graph is
// aliased out of any non-dev build. `command === 'serve'` covers `vite dev`;
// the perf harness opts a production build back in with VITE_PERF_PROBE=1.
const debugEntry = (command: string, env: Record<string, string>) =>
  command === 'serve' || env.VITE_PERF_PROBE === '1'
    ? path.resolve(__dirname, './src/debug/dev-only.ts')
    : path.resolve(__dirname, './src/debug/dev-only.noop.ts')

/**
 * Content-Security-Policy, injected into the built index.html only.
 *
 * The renderer holds `window.hermesDesktop` — vault read/write, mail send, the
 * whole IPC surface — and page JS can reach it by design, because that is what
 * it is for. So any script that gets into this document owns every note the
 * user has. The app also reads genuinely hostile input: mail is flattened to
 * text before display (see app/notes/mail-html.ts), but that is one layer, and
 * a CSP is the layer that holds when a filter has a bug.
 *
 * BUILD ONLY, on purpose. Vite's dev server injects inline scripts for HMR and
 * React Refresh, so a dev-safe policy would need `script-src 'unsafe-inline'` —
 * which is most of what the policy is for. Rather than ship a weakened rule to
 * keep dev quiet, the policy applies to what users actually run.
 *
 * The source lists below are not guesses: each was derived by shipping
 * `default-src 'none'`, walking every screen, and reading the violations off
 * the console. Anything removed here should be re-measured the same way.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    // Nothing is allowed unless a directive below says so.
    "default-src 'none'",
    // The app's own bundle. No inline, no eval — this is the directive that
    // makes injected markup inert.
    "script-src 'self'",
    // Tailwind's stylesheet plus React's style props, which are inline by
    // construction. Style injection cannot execute code; it can exfiltrate via
    // url(), which is why img-src/font-src below stay local.
    "style-src 'self' 'unsafe-inline'",
    // Bundled icons, generated images, and files served over the app's own
    // media protocol. No remote origins: a remote image in mail or a note is a
    // read receipt.
    "img-src 'self' data: blob: hermes-media:",
    "font-src 'self' data:",
    "media-src 'self' blob: hermes-media:",
    // The local agent gateway only.
    "connect-src 'self' blob: data: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*",
    // Workers ship in the bundle (CodeMirror, mermaid).
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    // A <base> tag could re-point every relative URL in the document.
    "base-uri 'none'",
    // Nothing in this app posts a form; an injected one should not be able to.
    "form-action 'none'"
  ].join('; ')

  return {
    apply: 'build',
    name: 'daat-csp',
    transformIndexHtml: {
      handler(html: string) {
        // index.html carries one inline script: it paints the themed background
        // before the bundle loads, which is the difference between opening a
        // window and opening a white flash. Allowing it with 'unsafe-inline'
        // would allow every OTHER inline script too — i.e. the exact thing this
        // policy exists to stop. Hash it instead, computed from what actually
        // ships so it can never drift from the file.
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          match => `'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`
        )

        const withHashes = hashes.length
          ? policy.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`)
          : policy

        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${withHashes}" />`
        )
      },
      order: 'post'
    }
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  css: {
    // Pin an explicit (empty) PostCSS config. Tailwind is handled entirely by
    // `@tailwindcss/vite`, so the renderer needs no PostCSS plugins — and
    // without this, Vite's `postcss-load-config` walks UP the filesystem
    // looking for a stray `postcss.config.*` / `tailwind.config.*`. The desktop
    // build runs from inside the user's home tree (e.g.
    // `C:\Users\<name>\AppData\Local\hermes\hermes-agent\apps\desktop`), so an
    // unrelated Tailwind v3 config higher up the tree gets picked up and
    // reprocesses our v4 stylesheet, failing the build with
    // "`@layer base` is used but no matching `@tailwind base` directive is
    // present." Pinning the config makes the build hermetic.
    postcss: { plugins: [] }
  },
  build: {
    // The renderer intentionally ships FEW chunks (not one, not thousands):
    //   · `codeSplitting: false` (the old setup) inlines every `lazy()` /
    //     dynamic import into the entry, so heavyweight lazy-only deps
    //     (mermaid, shiki grammars, katex) are parsed + evaluated on every
    //     cold start even though nothing rendered them. By the time the
    //     bundle hit ~28 MB that eval was ~1s of launch on an M-series.
    //   · Default splitting emits a chunk per shiki grammar/theme — thousands
    //     of files, which electron-builder OOMs scanning (#38888).
    // `advancedChunks` is the middle ground: heavyweight libraries merge into
    // a handful of named vendor chunks loaded on first use, app-level dynamic
    // imports stay lazy, and the file count stays in the tens.
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            // Shared foundations FIRST (first match wins): an unmatched
            // module shared by the entry and a heavy chunk gets merged INTO
            // the heavy chunk, and the entry then statically imports 19 MB of
            // shiki just to reach react/hast utils — putting the heavy chunk
            // right back on the boot path.
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            {
              name: 'vendor-md',
              test: /node_modules[\\/](property-information|hast-util-[^\\/]+|mdast-util-[^\\/]+|micromark[^\\/]*|unist-util-[^\\/]+|vfile[^\\/]*|unified|stringify-entities|space-separated-tokens|comma-separated-tokens|zwitch|html-void-elements|devlop|style-to-js|style-to-object|clsx)[\\/]/
            },
            // Shared utility packages the entry ALSO uses — kept out of the
            // heavy groups for the same boot-path reason.
            {
              name: 'vendor-util',
              test: /node_modules[\\/](lodash-es|es-toolkit|uuid|dayjs|d3-array|d3-color|d3-force|d3-interpolate|d3-time[^\\/]*|dompurify|stylis)[\\/]/
            },
            // One chunk per heavyweight, lazy-only library family.
            // @streamdown/code lives WITH shiki because it statically imports
            // the full shiki bundle.
            {
              name: 'mermaid',
              test: /node_modules[\\/](mermaid|cytoscape|dagre|khroma|elkjs|d3|d3-[^\\/]+|@mermaid-js)[\\/]/
            },
            {
              name: 'shiki',
              test: /node_modules[\\/](shiki|@shikijs|react-shiki|@streamdown[\\/]code|oniguruma-to-es|oniguruma-parser|regex(-[^\\/]+)?)[\\/]/
            },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '@/debug/dev-only': debugEntry(command, process.env as Record<string, string>),
      '@': path.resolve(__dirname, './src'),
      '@hermes/plugin-sdk': path.resolve(__dirname, './src/sdk/index.ts'),
      '@hermes/shared/billing': path.resolve(__dirname, '../shared/src/billing-types.ts'),
      '@hermes/shared': path.resolve(__dirname, '../shared/src'),
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      'react/jsx-dev-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-runtime.js')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: {
      allow: fsAllow
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
}))
