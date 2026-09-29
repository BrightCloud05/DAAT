/**
 * Saying what the install is doing when it looks like it has stopped.
 *
 * The install narrates itself perfectly well — install.sh logs a line before
 * every long wait — but those lines live behind a "Show output" disclosure that
 * a first-time user has no reason to open. On the outside they see a spinner on
 * a row called "prerequisites".
 *
 * The worst case is not slow, it is silent and interactive: when a Mac has no
 * usable git, install.sh fires `xcode-select --install` and then polls for
 * FIFTEEN MINUTES waiting for the tools to appear (install.sh:653-683). Apple's
 * own dialog is what has to be answered, and it can open behind the app window.
 * So the person sits watching a spinner, waiting for software that is waiting
 * for them.
 *
 * This turns the log line the installer already writes into a sentence at the
 * front of the screen. Matching on log text is a loose coupling and it is the
 * right one here: the alternative is a second channel between install.sh and
 * the renderer that has to be kept in step, and the failure mode of a missed
 * match is the status quo rather than a broken install.
 */

export interface InstallHint {
  /** Headline, in the words of someone who does not know what git is. */
  title: string
  /** What to do, if anything. Empty when the answer is "nothing, just wait". */
  body: string
  /** True when the install is blocked on the user rather than on the network. */
  needsYou: boolean
}

interface LogLine {
  line: string
}

const RULES: Array<{ match: RegExp; hint: InstallHint }> = [
  {
    // The 900-second poll. Both the request and the every-minute reminder.
    match: /command line tools|xcode-select/i,
    hint: {
      title: 'Your Mac needs one free part from Apple',
      body:
        'A grey box from Apple should be open — press Install and accept the licence. ' +
        'It may be hiding behind this window. If it asks for a password, it wants the one you use to unlock this Mac.',
      needsYou: true
    }
  },
  // Order matters: "Installing Python dependencies" is the package install, not
  // the Python download, and the looser rule below would otherwise claim it and
  // tell the user the wrong thing about the longest step in the install.
  {
    match: /installing (python )?dependencies|resolved \d+ packages|uv (pip )?sync/i,
    hint: {
      title: 'Installing the parts I run on',
      body: 'This is the long one — a few hundred megabytes. You can leave it and come back.',
      needsYou: false
    }
  },
  {
    match: /installing python\b(?! dep)|uv python install|downloading cpython|python .* not found, installing/i,
    hint: { title: 'Downloading Python', body: 'About 50 MB. Nothing for you to do.', needsYou: false }
  },
  {
    match: /node\.js not found|downloading node-v|installing node\.js/i,
    hint: { title: 'Downloading Node', body: 'About 90 MB. Nothing for you to do.', needsYou: false }
  },
  {
    match: /playwright|chromium/i,
    hint: { title: 'Setting up the browser I use for research', body: 'Nothing for you to do.', needsYou: false }
  },
  {
    match: /internet connectivity|checking network/i,
    hint: { title: 'Checking your internet', body: '', needsYou: false }
  }
]

/**
 * The most recent thing worth explaining, or null.
 *
 * Reads backwards: the newest matching line wins, because an install that has
 * moved on from waiting for Apple should stop saying it is waiting for Apple.
 */
export function installHint(log: LogLine[], scan = 40): InstallHint | null {
  const recent = log.slice(-Math.max(1, scan))

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const text = recent[index]?.line ?? ''

    for (const rule of RULES) {
      if (rule.match.test(text)) {
        return rule.hint
      }
    }
  }

  return null
}
