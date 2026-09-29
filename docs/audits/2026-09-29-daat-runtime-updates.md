# DAAT runtime update verification

Implemented locally on 2026-09-29. No commit, push, release publication, repository setting change, app restart, or installed-runtime migration was performed.

## Scope

- Stable upstream release detection and isolated merge preparation.
- Separate CI verification and credentialed proposal jobs.
- Protected DAAT runtime publication and bounded, integrity-checked desktop download.
- Existing transactional installer reused, including crash recovery and validation rollback.
- Offline staged-runtime probe verifies real DAAT vault provider discovery and durable Markdown writes.

## Executed checks

- `scripts/run_tests.sh tests/plugins/test_vault_filing.py tests/plugins/test_vault_recall.py tests/plugins/test_daat_tool_injection.py tests/hermes_cli/test_daat_automation_e2e.py tests/scripts/test_daat_runtime_package.py`: **51 passed**.
- Desktop Vitest electron project, `electron/agent-release.test.ts electron/agent-source.test.ts scripts/stage-agent-source.test.mjs`: **30 passed**.
- Desktop TypeScript `tsconfig.json`, `tsconfig.electron.json`, and `tsconfig.e2e.json`: **passed** using the installed TypeScript compiler and Node 24.14.1.
- Both workflow YAML files and the composite action parsed; embedded shell steps passed `bash -n`. GitHub-hosted workflows were not dispatched.
- Actual source staging: **44 MB**. Offline provider discovery + note persistence probe passed from the staged source.
- Actual runtime archive packaging: **17,898,718 bytes**. SHA-256 verified, archive extracted into a temporary directory, and the real note persistence probe passed again from extracted source. The local fixture used `v0.0.0-local-verification`; it is not a publishable upstream release.

Two regressions were observed failing before correction: swallowed fatal recovery errors, and an interrupted swap bypassed when an installed release was retained. Both now pass. Invalid checksums, traversal paths, incompatible desktop versions, validation rollback, restart without downgrade, user preference preservation, and disabled remote checks are covered through a real local HTTP server and temporary source trees.

## Remaining release gates

Independent Claude review was attempted through the configured CLI and failed before review with `OAuth session expired and could not be refreshed`. No model/authentication/billing settings were changed. Independent review is outstanding.

The workflows must be reviewed and integrated into `main`, `DAAT_SYNC_TOKEN` configured, and the protected release environment established before activation. Native packaged-app acceptance, new desktop distribution and migration of the legacy unstamped installed runtime remain outstanding. See `docs/daat-runtime-updates.md` for the activation procedure. Existing unrelated working-tree changes were preserved.
