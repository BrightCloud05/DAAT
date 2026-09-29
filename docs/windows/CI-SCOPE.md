# Windows CI acceptance scope

Build the preserved DAAT working source on a standard Windows x64 GitHub runner.
Keep the original Mac checkout and remote main unchanged. Use a separate CI branch.

Acceptance: locked dependency installation, typecheck, packaging regressions,
PowerShell 5.1/7 installer contracts, NSIS install, actual installed app bootstrap,
local Python health, Unicode note edit and restart persistence, silent uninstall.
No fake backend or developer Python environment may satisfy installed acceptance.

Risks: first-run dependency downloads, unsigned binaries, Windows Server differs
from consumer Windows, and provider sign-in needs an account. Record these limits.
The smoke probe records onboarding but bypasses its completion only for offline
note editing; it does not claim fresh-account onboarding acceptance.

Rollback: remove the isolated CI branch; no merge or public release is required.
A failed run must not publish a candidate as verified. Independent release review
and Windows 10/11 user acceptance remain separate gates.
