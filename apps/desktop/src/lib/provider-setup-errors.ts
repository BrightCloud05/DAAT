// "Hermes" kept alongside "BISEO": the Python backend still emits the upstream
// wording on the wire (tui_gateway/server.py) until its display strings are swept.
const PROVIDER_SETUP_ERROR_RE =
  /No (?:inference|Hermes|BISEO) provider(?: is)? configured|no_provider_configured|set an API key/i

const SESSION_INFO_CREDENTIAL_WARNING_RE = /^No API key configured for provider '[^']*'\. First message will fail\.$/

export function isProviderSetupErrorMessage(message: null | string | undefined): boolean {
  const text = message?.trim()

  if (!text) {
    return false
  }

  return PROVIDER_SETUP_ERROR_RE.test(text) || SESSION_INFO_CREDENTIAL_WARNING_RE.test(text)
}
