# Installing Daat on someone else's Mac

Written for the person doing the install, sitting next to the buyer or on a call
with them. It assumes the app is not signed by Apple, because today it is not.

## Before you go

Build the DMG on a Mac of the **same architecture** as the target machine:

```bash
cd apps/desktop && ALLOW_UNSIGNED=1 npm run dist:mac:dmg
```

The artifact lands in `apps/desktop/release/Daat-<version>-mac-arm64.dmg`.

`ALLOW_UNSIGNED=1` is required on purpose. Without an Apple Developer identity
electron-builder would skip signing *silently*, and an unsigned build would ship
looking exactly like a signed one — the flag makes shipping unsigned a decision
somebody made rather than something that happened.

**The build is arm64-only.** It will not launch on an Intel Mac. For a 2019-or-
earlier MacBook you need `npm run builder -- --mac dmg --x64`, and that build has
never been tested.

Confirm the machine before you travel: `  Apple menu → About This Mac`. "Chip:
Apple M…" is fine. "Processor: Intel…" is not.

## What the buyer's Mac needs

| | |
|---|---|
| macOS | 12 Monterey or newer |
| Chip | Apple Silicon |
| Free disk | ~1.5 GB (app ~500 MB, `~/.daat` ~500 MB, plus downloads) |
| Network | Required on first launch, and not a captive-portal café network |
| Admin password | Not needed for the app. Possibly needed once, for Xcode Command Line Tools |

## 1. Get the DMG onto the Mac

USB stick or AirDrop, either is fine. It matters for step 2: **AirDrop and web
downloads mark the file as quarantined; a copy from a USB stick does not.**

## 2. Install, and get past Gatekeeper

Open the DMG, drag **Daat** into **Applications**.

Then, because the app is not notarized by Apple, macOS will refuse to open it —
the message says "Apple could not verify Daat is free of malware", which reads
like an accusation and is really just "nobody paid Apple US$99 for this app".

Clear it in Terminal, once:

```bash
xattr -dr com.apple.quarantine /Applications/Daat.app
```

Then open the app normally. It will not ask again on this Mac.

If you would rather not open Terminal in front of the buyer: launch the app, let
it get refused, then go to **System Settings → Privacy & Security**, scroll to
the bottom, and press **Open Anyway**. Same result, more clicks. (Control-clicking
the app no longer works — Apple removed that path in macOS 15 Sequoia.)

## 3. First launch

The app installs its own runtime into `~/.daat`. It does **not** clone anything
from GitHub — the Python source ships inside the app bundle — so this works with
a private repository and works without git credentials.

Ten stages run, and the window narrates them. Expect **several minutes** on a new
Mac, most of it downloads:

| Stage | What is downloaded |
|---|---|
| prerequisites | uv, Python 3.11 (~50 MB), Node 22 (~90 MB) |
| repository | nothing — seeded from the app bundle |
| venv, python-deps | ~200–300 MB of Python wheels |
| node-deps, path, config | little |
| setup | nothing — this one asks the buyer a question |
| gateway, complete | little |

If macOS pops up a dialog asking to install the **Xcode Command Line Tools**,
accept it. It appears when the Mac has never had `git` used on it, and it needs
the buyer's admin password.

## 4. The one step that needs a human

The **setup** stage asks for a model provider. This is the part worth being
present for — it is the only step where a wrong answer leaves a working app that
cannot think.

Either bring an API key, or walk them through signing in to a provider they
already pay for. Whatever you pick gets written to `~/.daat/.env`.

## 5. Optional extras

Neither of these blocks anything. Each screen that needs one says so, names it,
and tells the user how to get it — verified by `scripts/probe-bare.mjs`.

- **Mail** needs the [`himalaya`](https://github.com/pimalaya/himalaya) CLI, plus
  an account configured in it. Without it the Mail screen explains itself and the
  rest of the app is unaffected.
- **ripgrep** and **ffmpeg** make search and voice faster. The installer tries
  `brew install` and shrugs if Homebrew is not there, which on a new Mac it is not.

## Where everything lands

```
/Applications/Daat.app          the app
~/.daat/                        runtime: agent source, venv, node, config, skills
~/.daat/.env                    API keys
~/.daat/logs/                   bootstrap logs — read these first when a launch fails
~/Library/Mobile Documents/…/   the vault, if iCloud Drive is available
~/Documents/Daat/Notes/         the vault, if it is not
```

To undo an install completely: delete `/Applications/Daat.app` and `~/.daat`.
The vault is deliberately *not* in either, so removing the app never removes the
buyer's notes.

## When first launch fails

`~/.daat/logs/` has one file per bootstrap run, with the full output of every
stage. That is the first thing to read, before re-running anything — a failed
stage is re-runnable, and the log says which one failed and why.

## Verifying before you ship a build

```bash
cd apps/desktop
node scripts/probe-fresh-mac.mjs   # a bare Mac ends up with a working agent
node scripts/probe-bare.mjs        # every screen explains its missing dependency
```

`probe-fresh-mac.mjs` seeds a throwaway `HERMES_HOME` from the built bundle,
strips PATH to the four directories macOS ships with, runs the real install
stages, and then checks that `hermes` **actually starts**. Stage exit codes are
not the bar: the first time it ran, all six stages passed and the agent died on
`No module named 'hermes_constants'`.

One caveat it cannot cover: on a developer's Mac, uv reuses a cached Python and a
warm wheel cache that live outside `HERMES_HOME`. The probe proves the install is
*correct*; it says nothing useful about how *long* it takes on a machine where
none of that is cached.
