"""Current-note context bridge.

Daat Desktop writes <HERMES_HOME>/state/vault-context.json whenever the
active note or selection changes; this hook injects a compact block into the
next turn so the agent always knows what the user is looking at. Stale
payloads (older than the freshness window) are ignored — an idle desktop
must not haunt tomorrow's conversations.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

FRESH_MS = 5 * 60 * 1000
MAX_SELECTION_CHARS = 3_000


def _bridge_path() -> Path:
    home = os.environ.get("HERMES_HOME", "").strip() or str(Path.home() / ".daat")

    return Path(home) / "state" / "vault-context.json"


def pre_llm_call(**kwargs):
    try:
        payload = json.loads(_bridge_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    updated = payload.get("updated_at")

    if not isinstance(updated, (int, float)) or (time.time() * 1000 - updated) > FRESH_MS:
        return None

    note = str(payload.get("active_note") or "").strip()

    if not note:
        return None

    parts = [f"[Daat context] The user is currently viewing the vault note: {note}"]
    selection = str(payload.get("selection") or "").strip()

    if selection:
        clipped = selection[:MAX_SELECTION_CHARS]
        parts.append(f'Selected text: """{clipped}"""')

    parts.append("Use vault_read/vault_write/vault_search to work with vault notes when relevant.")

    return {"context": "\n".join(parts)}
