# Daat Design Spec (2026-07-28)

Commercial macOS app: the hermes-agent (MIT, Nous Research) multi-provider AI agent
fused with an Obsidian-style markdown vault (second brain), sold as a notarized DMG.
Codename **Daat** — all branding replaceable before launch.

## Product decisions (user-confirmed)

| Decision | Value |
|---|---|
| Base | Fork of the full hermes-agent monorepo, pinned (no upstream tracking; quarterly security cherry-picks) |
| Identity | appId `com.tax123.daat`, product/executable `Daat`, protocol `daat://`, home `~/.daat`, repo `daat-app/daat-agent` |
| Rebrand depth | App-level only; internal `hermes` CLI / `HERMES_*` env / IPC names kept for upstream mergeability |
| v1 scope | Vault + CM6 editor + wikilinks/backlinks + agent chat with vault tools + persona onboarding + iCloud vault |
| AI cost model | BYOK + all hermes OAuth flows exposed (subscription-OAuth ToS risk was flagged; user accepted; disclaimer copy + kill-switch flag required) |
| Languages | English default + Korean locale |
| Distribution | Direct notarized DMG + Lemon Squeezy license ($69 one-time, perpetual + 1yr updates); fail-soft: vault/editor stay free forever |
| Vault | Own format (folder of .md, no `.obsidian/`); default iCloud `com~apple~CloudDocs/Daat/Notes/`, fallback `~/Documents/Daat/Notes/` |

## Architecture

1. **Vault subsystem** — first-class in-tree surface via the contribution registry.
   Electron main: `electron/vault/{vault-service,vault-watcher,vault-index,vault-parser,vault-fs,vault-ipc}.ts`
   (@parcel/watcher + remark/wiki-link parser in a utilityProcess + better-sqlite3 FTS5 index in
   `userData/vault-index/` — never inside the vault). Preload: `window.hermesDesktop.vault.*`.
   Renderer: `src/app/vault/` — CM6 editor pane (live preview + wikilinks + frontmatter seeded from
   SilverBullet/atomic-editor, MIT only), react-arborist tree, backlinks pane; panes registered in
   `src/app/contrib/vault.tsx`, "Notes" layout preset = tree │ editor │ chat.
2. **Agent integration** — bundled Python plugin `plugins/vault/` registering toolset `vault`
   (`vault_read/write/list/search/backlinks`), path-traversal guarded, atomic writes; env
   `VAULT_PATH`/`VAULT_INDEX_DB` injected via `electron/backend-env.ts`; current-note context via
   `<HERMES_HOME>/state/vault-context.json` + `pre_llm_call` hook (obsidian-context-bridge pattern).
3. **Personas** — in-repo `personas/<id>/` in profile-distribution format (SOUL.md +
   config-fragment.yaml + skill-bundles + cron blueprints); applied to the default profile at
   onboarding by new `hermes_cli/personas.py` + REST endpoints; apply only at session boundaries.
   Six presets: Student, Accounting, Office Admin, Programming, Secretary, General.
4. **iCloud** — atomic temp+rename writes, mtime conflict → conflict-copy + UI event, `.icloud`
   placeholder + FileProvider dataless handling (`brctl download` escalation), NFC/case-insensitive
   wikilink resolution.
5. **Release** — self-update local rebuild disabled (shell updates via signed DMG feed only; core
   updates pinned to fork release tags); hide-don't-rip for messaging/kanban/pet/cloud/cron-UI;
   CLI not installed on PATH; MIT attribution (root LICENSE, in-app Acknowledgements,
   THIRD_PARTY_NOTICES); no GPL code (Zettlr/Logseq/Notesnook/AppFlowy are architecture-reference only).

## Milestones

M0 fork boots under Daat identity (~1w) → M1 vault MVP (~2-3w) → M2 editor polish + links (~2-3w)
→ M3 agent↔vault (~1-2w) → M4 personas + release hardening (~2w). Total ~8-11 weeks.

Full implementation detail: see the approved plan (plan file `dreamy-imagining-shamir.md`) and the
recon reports referenced there.
