# Daat

**Your notes, your files, your Mac — with an assistant that can actually use them.**

Daat is a macOS app that puts a Notion-style writing experience on plain
markdown files you own, next to an AI assistant that can read and write those
files and operate your Mac.

Your notes use no proprietary format: they are `.md` files in a folder —
open them in any editor, sync them with iCloud, back them up however you like,
and take them with you if you ever stop using Daat. A rebuildable SQLite index powers search and task lists.

---

## What's in it

| | |
|---|---|
| **Notes** | Live-preview markdown editor, `/` block menu, wikilinks and backlinks, callouts, page icons, properties, templates, daily notes |
| **Todo** | Every checkbox in the vault, grouped by when it's due |
| **Calendar** | A month view built from the dates already in your notes |
| **Mail** | Read, sort and draft from your own IMAP account, via [Himalaya](https://github.com/pimalaya/himalaya) |
| **AUTOMATION** | Create, edit, pause, run and inspect scheduled Hermes jobs in a dedicated page; replaces the Money menu |
| **CAT settings** | Start/stop the menu bar companion, choose automatic launch and which metrics appear |
| **Tools & skills** | Manage the existing Hermes skills and toolsets from the notes sidebar |
| **Meetings** | Record audio into the vault, transcribe locally and prepare meeting notes |
| **Assistant** | Multi-provider (bring your own key, or sign in), works inside the note you're writing, and can use the tools on your machine |

The assistant reaches your notes through a small set of explicit tools
(`vault_read`, `vault_write`, `vault_search`, …) scoped to the vault folder.
Sending mail always goes through a human approval prompt that fails closed.

## Automation and CAT

Open **AUTOMATION** in the sidebar, choose **New automation**, describe the task,
and select its schedule and delivery destination. Jobs use the existing Hermes
scheduler and are stored per profile. The desktop backend or a Hermes gateway
must remain running; the Mac must be awake. Connected tasks also require network
access and configured credentials. The app does not install a macOS wake service.
Existing `Money/*.md` files remain ordinary notes; no ledger files are deleted.

Open **CAT settings** to control the companion and metric visibility. Codex usage
is opt-in. CAT reads the active DAAT runtime home and does not rotate OAuth tokens.

## Status

Pre-release, in active development. Building toward a signed, notarized DMG.

## Requirements

- macOS (Apple Silicon or Intel)
- An AI provider — an API key, or an account you sign in to

## Development

```bash
npm ci
uv sync --locked --extra dev --extra web
npm run dev --workspace apps/desktop
```

Tests:

```bash
cd apps/desktop && npx vitest run
```

```bash
scripts/run_tests.sh -j 2 tests/plugins tests/hermes_cli/test_daat_automation_e2e.py
```

Use the canonical test runner: it isolates the runtime home and credentials.
Do not point automated probes at your personal vault or live accounts.

There are also headless Electron probes that drive the real app end to end:
`apps/desktop/scripts/probe-editor.mjs`, `probe-onboarding.mjs`,
`probe-modules.mjs`.

## Built on Hermes Agent

Daat is a fork of [Hermes Agent](https://github.com/NousResearch/hermes-agent)
by Nous Research, used under the MIT licence. The runtime is integrated through
the official stable release [v2026.9.11 (Hermes 0.21.2)](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.11);
the DAAT notes client remains its own surface. The original copyright notice is
preserved in [LICENSE](LICENSE), and third-party notices ship with the app.

Hermes Agent is Nous Research's project; their names and logos are theirs.
Daat is not affiliated with or endorsed by Nous Research.

## Licence

MIT — see [LICENSE](LICENSE).
