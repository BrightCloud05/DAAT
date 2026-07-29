# BISEO

**Your notes, your files, your Mac — with an assistant that can actually use them.**

BISEO is a macOS app that puts a Notion-style writing experience on plain
markdown files you own, next to an AI assistant that can read and write those
files and operate your Mac.

No database, no proprietary format. Your notes are `.md` files in a folder —
open them in any editor, sync them with iCloud, back them up however you like,
and take them with you if you ever stop using BISEO.

---

## What's in it

| | |
|---|---|
| **Notes** | Live-preview markdown editor, `/` block menu, wikilinks and backlinks, callouts, page icons, properties, templates, daily notes |
| **Todo** | Every checkbox in the vault, grouped by when it's due |
| **Calendar** | A month view built from the dates already in your notes |
| **Mail** | Read, sort and draft from your own IMAP account, via [Himalaya](https://github.com/pimalaya/himalaya) |
| **Money** | Drop a photo of a bank statement and the assistant files the transactions into a markdown ledger |
| **Assistant** | Multi-provider (bring your own key, or sign in), works inside the note you're writing, and can use the tools on your machine |

The assistant reaches your notes through a small set of explicit tools
(`vault_read`, `vault_write`, `vault_search`, …) scoped to the vault folder.
Sending mail always goes through a human approval prompt that fails closed.

## Status

Pre-release, in active development. Building toward a signed, notarized DMG.

## Requirements

- macOS (Apple Silicon or Intel)
- An AI provider — an API key, or an account you sign in to

## Development

```bash
cd apps/desktop && npm install && npm run dev
```

Tests:

```bash
cd apps/desktop && npx vitest run
```

```bash
uv run --extra dev pytest tests/
```

The `--extra dev` is required — without it every async test errors out on a
missing `pytest-asyncio`.

There are also headless Electron probes that drive the real app end to end:
`apps/desktop/scripts/probe-editor.mjs`, `probe-onboarding.mjs`,
`probe-modules.mjs`.

## Built on Hermes Agent

BISEO is a fork of [Hermes Agent](https://github.com/NousResearch/hermes-agent)
by Nous Research, used under the MIT licence. The original copyright notice is
preserved in [LICENSE](LICENSE), and third-party notices ship with the app.

Hermes Agent is Nous Research's project; their names and logos are theirs.
BISEO is not affiliated with or endorsed by Nous Research.

## Licence

MIT — see [LICENSE](LICENSE).
