# DAAT Cat 🐱

RunCat-style macOS menu bar monitor, connected to **DAAT**.
A cat runs in the menu bar at a speed proportional to CPU load; clicking it
opens a RunCat-style panel plus two DAAT-specific sections.

## Panel contents

| Section | Source |
|---|---|
| CPU / Memory / Storage / Battery / Network | Same metrics RunCat shows (host_statistics, IOKit, getifaddrs) |
| **Agent Credits (OpenAI OAuth)** | `~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage` — plan, usage window %, reset countdown, rate-limit-reset vouchers |
| **DAAT 진행사항** | Live agent state from `HERMES_HOME` (`~/.hermes`) |

## How the DAAT connection works

DAAT (Daat.app) is the desktop shell of the hermes agent. The menu bar app
polls, in priority order:

1. `~/.daat/menubar.json` — optional manual feed/override:
   ```json
   { "project": "IDTAX", "task": "BAS draft", "phase": "running",
     "percent": 62.5, "detail": "step 3/5", "updated_at": "2026-08-06T12:00:00Z" }
   ```
2. **Real DAAT state** (read-only, never writes):
   - `~/.hermes/desktop/interrupted_turns.json` — the turn running *right now*
     (written at turn start, cleared at end; sub-second freshness)
   - `~/.hermes/state.db` (SQLite `?mode=ro`) — active sessions
     (`ended_at IS NULL`, last activity < 300 s — DAAT's own liveness rule),
     current step text, model, message/tool counts
   - `~/.hermes/projects.db` — maps session `cwd`/`git_repo_root` → project name
   - `~/.hermes/gateway_state.json` — gateway health / active agents
3. `~/.codex/session_index.jsonl` — standalone Codex CLI fallback

## Build & run

```bash
./make-app.sh          # builds + installs ~/Applications/DAAT Cat.app + ad-hoc signs
open "$HOME/Applications/DAAT Cat.app"
```

Dev loop: `swift build && swift run` (frames load from `Resources/cat` via
fallback paths). UI preview without launching:
`DAATCAT_PREVIEW=1 .build/release/DaatCat` → writes `daatcat-preview.png`.

The **Login** rail button registers the app as a login item (SMAppService).

## Attribution / licenses

- Cat animation frames and the CPU→speed mapping are adapted from
  [Kyome22/menubar_runcat](https://github.com/Kyome22/menubar_runcat)
  (Apache License 2.0 — see `reference/menubar_runcat_LICENSE`).
  RunCat's full successor is open source at
  [runcat-dev/RunCatNeo](https://github.com/runcat-dev/RunCatNeo) (Apache-2.0,
  requires Xcode 26.5+ to build).
- OpenAI OAuth usage endpoints follow the approach documented by
  [steipete/CodexBar](https://github.com/steipete/CodexBar) (`docs/codex.md`).
- Tokens are read from `~/.codex/auth.json` in memory only; nothing is ever
  written back, and no data leaves the machine except the usage API calls to
  `chatgpt.com`.
