# DAAT runtime updates

DAAT follows **stable Hermes releases through its own integration and release process**. It does not replace DAAT with a checkout of upstream Hermes. This preserves DAAT's built-in notes, vault memory, mail, meetings, and automation integration.

## Delivery path

1. `Follow stable Hermes releases` checks GitHub every six hours (or on manual dispatch).
2. It fetches the release tag from `NousResearch/hermes-agent`, resolves its commit, and merges it on an isolated CI branch. Conflicts fail the job without changing DAAT's default branch.
3. Desktop type checks, updater tests, DAAT notes/memory/automation tests, and a real staged-source note persistence probe must pass before a separate job opens a review PR. Integration commits preserve upstream authorship. Existing integration branches are never force-pushed.
4. After independent review and merge, `Publish verified DAAT runtime` verifies the merged revision again. Publishing requires the protected `daat-runtime-release` environment with required reviewers and prevention of self-review.
5. Packaged DAAT checks for its own runtime releases before starting its managed backend, at most once every six hours after a successful check. It verifies the archive checksum, bounded paths/size, required DAAT capabilities and minimum desktop version, then uses the existing transactional source/environment installer.

Downloaded source is trusted as code published by `BrightCloud05/DAAT` over HTTPS. SHA-256 detects corrupted/mismatched assets; it is not an independent publisher signature. Protect repository release permissions and the release environment accordingly.

Application UI updates still need a new DAAT application package. A runtime requiring a newer desktop waits for that application update. Running conversations are not restarted by this feature; scheduled checks on GitHub do not mean a continuously running desktop swaps its engine in place. Network failure leaves the current runtime in place. Validation failure restores the previous runtime; recovery failure stops startup and preserves recovery files.

## User control

Remote runtime checks default to enabled for managed, stamped installations. To turn them off, set this in **DAAT's** `config.yaml` (the profile resolved by the app, normally under `.daat`):

```yaml
updates:
  runtime_auto_update: false
```

This disables remote runtime checks only; source refresh from a newly installed desktop bundle remains available. Logs use `[runtime-update]` and `[agent-source]` prefixes. The updater does not change the selected model, credentials, billing, personal Hermes, Obsidian, or the notes directory.

Unknown-ownership legacy installations (`no-stamp`), Git checkouts, modified owned files, and conflicting user paths are not silently overwritten. They require an explicit migration/repair preserving the original installation. Do not fabricate a stamp to bypass that check.

## Activation checklist

- Integrate the DAAT changes and these workflows into `BrightCloud05/DAAT`'s `main` branch. They depend on the DAAT source updater and custom plugins in this working tree.
- Add the `DAAT_SYNC_TOKEN` Actions secret: a fine-grained token limited to this repository with Contents, Pull requests and Workflows write permissions. Only the separate proposal job receives it; upstream tests run with a read-only job token. Hermes integration may change workflow files, for which GitHub requires [Workflows write permission](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).
- Configure the `daat-runtime-release` environment with an independent required reviewer and **Prevent self-review** enabled. The publishing workflow refuses an absent/unprotected environment.

- Run `Follow stable Hermes releases`, review its integration PR, and merge it. If a release conflicts or fails validation, resolve it through review; this automation never resolves conflicts by dropping DAAT changes.
- Approve the protected runtime release after reviewing its validation. Published runtime assets are immutable by convention; reruns do not replace them. Failed publication may require removing a draft/incomplete release through a reviewed administrative action.
- Build and distribute a DAAT desktop containing `agent-release.ts`. Previously installed desktop binaries do not acquire this updater from source changes alone. Migrate any legacy unmanaged runtime separately.

No schedule, protected environment, remote release, app installation, or legacy migration is activated by local code edits. Local checks also do not substitute for native packaged-app acceptance or the independent release review.

The policy preflight uses GitHub's [Get an environment API](https://docs.github.com/en/rest/deployments/environments#get-an-environment), with `actions: read` permission.
