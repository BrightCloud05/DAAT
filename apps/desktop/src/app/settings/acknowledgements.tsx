/**
 * Acknowledgements — the licences BISEO is obliged to reproduce.
 *
 * MIT, BSD, ISC and Apache all require their notice to travel with binary
 * copies, and CC-BY (the icon set) requires attribution. Shipping the text in
 * the bundle and never showing it satisfies the letter and not the point, so
 * this screen exists and is reachable from About.
 */

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'

export function Acknowledgements() {
  const [notices, setNotices] = useState<{ license: string; thirdParty: string } | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.hermesDesktop
      ?.appNotices?.()
      .then(result => !cancelled && setNotices(result))
      .catch(() => !cancelled && setNotices({ license: '', thirdParty: '' }))

    return () => {
      cancelled = true
    }
  }, [])

  const packages = notices?.thirdParty
    ? notices.thirdParty.split('\n').filter(line => / — (MIT|ISC|BSD|Apache|CC-BY|MPL|Unlicense|Python)/.test(line))
    : []

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        BISEO is built on{' '}
        <button
          className="underline underline-offset-2 hover:opacity-80"
          onClick={() =>
            void window.hermesDesktop?.openExternal?.('https://github.com/NousResearch/hermes-agent')
          }
        >
          Hermes Agent
        </button>{' '}
        by Nous Research, used under the MIT licence, together with{' '}
        {packages.length ? `${packages.length} open-source packages` : 'a number of open-source packages'}. Their
        licences are reproduced below and ship inside the app.
      </p>

      {notices === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {notices.license ? (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Hermes Agent</h3>
              <pre className="max-h-64 overflow-auto rounded-lg border border-border/70 bg-muted/20 p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
                {notices.license}
              </pre>
            </section>
          ) : null}

          <section>
            <div className="mb-1.5 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">Bundled packages</h3>
              {packages.length ? <span className="text-xs text-muted-foreground">{packages.length}</span> : null}
            </div>

            {notices.thirdParty ? (
              <>
                <pre className="max-h-64 overflow-auto rounded-lg border border-border/70 bg-muted/20 p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
                  {expanded ? notices.thirdParty : packages.join('\n')}
                </pre>
                <Button className="mt-2" onClick={() => setExpanded(value => !value)} size="sm" variant="textStrong">
                  <Codicon name={expanded ? 'chevron-up' : 'chevron-down'} />
                  {expanded ? 'Show the list only' : 'Show full licence texts'}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Licence notices are generated at build time and weren't found in this build.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
