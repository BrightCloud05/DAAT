"""Thin wrapper over the Himalaya CLI (IMAP/SMTP email, JSON output).

Every call is a subprocess with an explicit argv list — no shell — so
addresses and subjects can never be interpreted as shell syntax. Himalaya
owns the account config and credentials (~/.config/himalaya/config.toml);
BISEO never handles passwords.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

TIMEOUT_S = 60
SEND_TIMEOUT_S = 120


class MailError(RuntimeError):
    """A Himalaya invocation failed; the message is safe to show the model."""


def binary() -> str | None:
    explicit = os.environ.get("HIMALAYA_BIN", "").strip()

    if explicit and Path(explicit).exists():
        return explicit

    found = shutil.which("himalaya")

    if found:
        return found

    # Common user-local install location (not always on a GUI app's PATH).
    fallback = Path.home() / ".local" / "bin" / "himalaya"

    return str(fallback) if fallback.exists() else None


def available() -> bool:
    return binary() is not None


def run(args: list[str], *, account: str | None = None, json_out: bool = True, timeout: int = TIMEOUT_S,
        stdin_text: str | None = None, positional: list[str] | None = None):
    """Run himalaya and return parsed JSON (or raw text when json_out=False).

    `positional` (search query words, message ids) is appended AFTER every
    flag: himalaya treats anything following a positional as part of it, so
    flags placed last are silently swallowed into the query.
    """
    exe = binary()

    if not exe:
        raise MailError(
            "Himalaya is not installed. BISEO uses it for email — install it, then run the "
            "account wizard (`himalaya account configure`)."
        )

    argv = [exe, *args]

    if account:
        argv += ["-a", account]

    if json_out:
        argv += ["-o", "json"]

    if positional:
        argv += positional

    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            input=stdin_text,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except subprocess.TimeoutExpired:
        raise MailError(f"Email command timed out after {timeout}s.") from None

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        tail = " ".join(line for line in detail[-4:] if "WARN" not in line)

        raise MailError(f"Email command failed: {tail or 'unknown error'}")

    output = (proc.stdout or "").strip()

    if not json_out:
        return output

    if not output:
        return []

    try:
        return json.loads(output)
    except json.JSONDecodeError:
        # Himalaya occasionally prefixes warnings; take the JSON payload.
        start = min((i for i in (output.find("["), output.find("{")) if i != -1), default=-1)

        if start != -1:
            try:
                return json.loads(output[start:])
            except json.JSONDecodeError:
                pass

        raise MailError("Email command returned unreadable output.") from None


def accounts() -> list[dict]:
    data = run(["account", "list"])

    return data if isinstance(data, list) else []


def default_account() -> str | None:
    for entry in accounts():
        if entry.get("default"):
            return entry.get("name")

    listed = accounts()

    return listed[0].get("name") if listed else None
