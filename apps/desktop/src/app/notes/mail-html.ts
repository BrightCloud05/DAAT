/**
 * Turn an HTML email into readable text.
 *
 * Mail arrives as HTML whenever the sender omits a text/plain alternative, and
 * himalaya passes it through untouched — so the reading pane was showing raw
 * markup. Newsletters are the common case, which means it is most of the mail
 * that actually lands in an inbox.
 *
 * WHY THIS CONVERTS RATHER THAN RENDERS
 *
 * The renderer holds `window.hermesDesktop`: vault read/write, mail send, the
 * whole IPC surface. Email is the most hostile input this app accepts — anyone
 * can send one — and there is currently no CSP to catch a sanitiser mistake.
 * Injecting sender-controlled markup into that document is one bug away from
 * handing a stranger every note the user owns.
 *
 * Two more reasons that hold even with a perfect sanitiser:
 *
 *   · Remote content is a beacon. A single <img> tells a spammer the address
 *     is live, when it was read, and roughly from where. Converting to text
 *     means nothing is ever fetched, rather than relying on a blocklist.
 *   · Daat is an agent, and this text reaches the model. HTML can hide
 *     instructions the reader cannot see — white-on-white, display:none,
 *     zero-size elements, comments. A divergence between what the user reads
 *     and what the model reads IS the attack. Flattening to text closes it:
 *     both see the same characters, and anything hidden becomes visible.
 *
 * HOW THE PARSING IS SAFE
 *
 * `DOMParser.parseFromString(html, 'text/html')` builds an inert document:
 * scripts do not execute, `<img>` and `<link>` do not fetch, inline handlers
 * never fire. Nothing here is ever attached to the live document. That is a
 * platform guarantee rather than a filter we maintain, which is exactly what
 * you want between a stranger's markup and a vault.
 */

/** Elements whose content is markup or styling, never prose. */
const DROP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED'])

/** Elements that should start a new line in the output. */
const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DD', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TD', 'TH', 'TR', 'UL'
])

/**
 * Does this look like HTML rather than a plain-text body?
 *
 * Deliberately conservative: a plain-text mail that merely mentions `<div>` in
 * prose should stay untouched, so this wants a real tag pair or a document
 * marker, not just an angle bracket.
 */
export function looksLikeHtml(body: string): boolean {
  const sample = body.slice(0, 4000)

  return (
    /<!doctype\s+html/i.test(sample) ||
    /<html[\s>]/i.test(sample) ||
    /<body[\s>]/i.test(sample) ||
    (/<(div|table|p|span|br|img|a)\b[^>]*>/i.test(sample) && /<\/(div|table|p|span|a)>/i.test(sample))
  )
}

function isHidden(element: Element): boolean {
  const style = element.getAttribute('style') ?? ''

  // Hidden content is where prompt injection lives. It is NOT dropped — the
  // reader should see everything the model sees — but marking it means neither
  // is quietly steered by text the other cannot read.
  return (
    /display\s*:\s*none/i.test(style) ||
    /visibility\s*:\s*hidden/i.test(style) ||
    /font-size\s*:\s*0/i.test(style) ||
    element.hasAttribute('hidden')
  )
}

/** Absolute http(s) links only; javascript:/data: are never surfaced. */
function safeHref(value: string | null): string {
  if (!value) {
    return ''
  }

  const href = value.trim()

  return /^https?:\/\//i.test(href) ? href : ''
}

function walk(node: Node, out: string[], hidden: boolean): void {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? ''

    if (text.trim()) {
      // Collapse HTML whitespace the way a browser would.
      out.push(hidden ? `[hidden: ${text.replace(/\s+/g, ' ')}]` : text.replace(/\s+/g, ' '))
    } else if (text.length) {
      out.push(' ')
    }

    return
  }

  if (node.nodeType !== 1) {
    return
  }

  const element = node as Element
  const tag = element.tagName.toUpperCase()

  if (DROP.has(tag)) {
    return
  }

  const nowHidden = hidden || isHidden(element)

  if (tag === 'BR') {
    out.push('\n')

    return
  }

  if (tag === 'HR') {
    out.push('\n———\n')

    return
  }

  if (tag === 'IMG') {
    const alt = element.getAttribute('alt')?.trim()

    // Named, never fetched: the reader learns an image was here without the
    // sender learning the message was opened.
    out.push(alt ? `[image: ${alt}]` : '[image]')

    return
  }

  if (BLOCK.has(tag)) {
    out.push('\n')
  }

  if (tag === 'LI') {
    out.push('• ')
  }

  for (const child of Array.from(element.childNodes)) {
    walk(child, out, nowHidden)
  }

  if (tag === 'A') {
    const href = safeHref(element.getAttribute('href'))
    const label = (element.textContent ?? '').replace(/\s+/g, ' ').trim()

    // Show the real destination unless the text already is it. Phishing works
    // by making these two disagree, so the reader should see both.
    if (href && label && label !== href) {
      out.push(` <${href}>`)
    } else if (href && !label) {
      out.push(href)
    }
  }

  if (BLOCK.has(tag)) {
    out.push('\n')
  }
}

/**
 * Flatten an HTML mail body to text.
 *
 * Returns the input unchanged when it does not look like HTML, so plain-text
 * mail is never mangled.
 */
export function htmlMailToText(body: string): string {
  if (!looksLikeHtml(body)) {
    return body
  }

  let doc: Document

  try {
    doc = new DOMParser().parseFromString(body, 'text/html')
  } catch {
    return body
  }

  const out: string[] = []

  walk(doc.body ?? doc, out, false)

  return out
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
