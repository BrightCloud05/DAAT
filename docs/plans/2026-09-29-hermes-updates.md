# DAAT runtime update plan

Scope: follow stable Hermes releases while retaining DAAT's notes, vault memory, mail, meetings, and cron integration. The desktop consumes only tested DAAT runtime releases, never upstream source directly.

Acceptance: discover stable upstream releases on a schedule; merge on a separate branch and validate before proposing integration; publish a runtime archive only after a separate release review gate; verify its SHA-256, bounded extraction, and desktop compatibility on the client; apply at startup through the existing transactional installer. Failed checks must leave the running version usable. Existing conversations, selected model, credentials, billing, and personal Hermes/Obsidian remain outside the update scope.

Risks: upstream merge conflicts need review; a new desktop contract requires a newer app; legacy unowned or locally modified runtime installations must not be overwritten automatically. Keep those ownership protections and report the reason instead of claiming success.

Rollback: client source replacement uses the existing recovery journal and restores the previous source/environment on validation failure. Disable future remote runtime checks with `updates.runtime_auto_update: false` in DAAT's config.yaml. Do not automatically downgrade a previously updated runtime to the older source bundled in the same desktop version.

Activation requires these workflows on the repository's default branch and the `daat-runtime-release` environment configured with an independent required reviewer. Local implementation/testing does not activate GitHub schedules or publish a release.
