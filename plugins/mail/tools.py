"""Mail tool implementations.

Read/organize operations run directly. The two outward-facing actions —
sending mail and moving/deleting messages — are different in kind: sending
is irreversible and speaks as the user, so `mail_send` always goes through
the human approval gate (`request_tool_approval`), which fails CLOSED when
no human can answer.
"""

from __future__ import annotations

import shlex
from typing import Any

from . import himalaya

MAX_BODY_CHARS = 20_000
DEFAULT_PAGE_SIZE = 25


def _account(name: str | None) -> str | None:
    """Account names reach argv; refuse flag-shaped or multiline values."""
    return himalaya.safe_name(name, "account") if name and str(name).strip() else None


def _fmt_envelope(env: dict[str, Any]) -> str:
    sender = env.get("from") or {}
    who = sender.get("name") or sender.get("addr") or "unknown"
    flags = env.get("flags") or []
    unread = "" if "Seen" in flags else "• "
    attach = " 📎" if env.get("has_attachment") else ""

    return f'{unread}[{env.get("id")}] {env.get("date", "")} — {who}: {env.get("subject", "(no subject)")}{attach}'


def mail_accounts() -> str:
    if not himalaya.available():
        return (
            "Email isn't connected yet. Daat uses the Himalaya CLI; ask the user to connect an "
            "account in Settings → Mail."
        )

    try:
        entries = himalaya.accounts()
    except himalaya.MailError as error:
        return str(error)

    if not entries:
        return "No email accounts are configured."

    lines = []

    for entry in entries:
        mark = " (default)" if entry.get("default") else ""
        lines.append(f'{entry.get("name")}{mark} — {entry.get("backend", "")}')

    return "\n".join(lines)


def mail_folders(account: str | None = None) -> str:
    try:
        data = himalaya.run(["folder", "list"], account=_account(account))
    except himalaya.MailError as error:
        return str(error)

    names = [entry.get("name", "") for entry in data if isinstance(entry, dict)]

    return "\n".join(names) if names else "(no folders)"


def mail_list(folder: str = "INBOX", limit: int = DEFAULT_PAGE_SIZE, account: str | None = None) -> str:
    size = max(1, min(int(limit or DEFAULT_PAGE_SIZE), 100))

    try:
        data = himalaya.run(
            ["envelope", "list", "-f", himalaya.safe_name(folder, "folder"), "-s", str(size)],
            account=_account(account),
        )
    except himalaya.MailError as error:
        return str(error)

    if not isinstance(data, list) or not data:
        return f"No messages in {folder}."

    header = f"{folder} — {len(data)} message(s), newest first:"

    return "\n".join([header, *(_fmt_envelope(env) for env in data if isinstance(env, dict))])


def _html_to_text(html: str) -> str:
    """Compact HTML → readable text (no dependency; newsletters are HTML-only)."""
    import html as html_mod
    import re

    text = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|tr|li|h[1-6]|table)>", "\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "- ", text)
    # Keep link targets: <a href="url">label</a> -> label (url)
    text = re.sub(r'(?is)<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', r"\2 (\1)", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_mod.unescape(text)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)

    return text.strip()


def _read_raw_body(message_id: str, folder: str, account: str | None) -> str | None:
    """Fallback for HTML-only mail: export the raw .eml and parse it ourselves."""
    import email
    import tempfile
    from email import policy
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "message.eml"

        try:
            himalaya.run(
                ["message", "export", "-f", himalaya.safe_name(folder, "folder"), "--full", "-d", str(target)],
                account=_account(account),
                json_out=False,
                positional=[himalaya.safe_id(message_id)],
            )
        except himalaya.MailError:
            return None

        if not target.exists():
            return None

        try:
            message = email.message_from_bytes(target.read_bytes(), policy=policy.default)
        except Exception:  # noqa: BLE001 — malformed MIME, fall back to nothing
            return None

    plain_text = ""
    plain = message.get_body(preferencelist=("plain",))

    if plain is not None:
        try:
            plain_text = plain.get_content().strip()
        except Exception:  # noqa: BLE001
            plain_text = ""

    # Some senders ship a junk text/plain alternative (a template bug leaves a
    # literal "undefined", or a one-line "view in browser"). Prefer HTML when
    # the plain part is empty or clearly not the message.
    if plain_text and plain_text.lower() not in ("undefined", "null") and len(plain_text) > 40:
        return plain_text

    rich = message.get_body(preferencelist=("html",))

    if rich is not None:
        try:
            converted = _html_to_text(rich.get_content())

            if converted:
                return converted
        except Exception:  # noqa: BLE001
            pass

    return plain_text or None


def mail_read(message_id: str, folder: str = "INBOX", account: str | None = None, mark_seen: bool = False) -> str:
    if not str(message_id).strip():
        return "Provide the message id from mail_list."

    try:
        args = ["message", "read", "-f", himalaya.safe_name(folder, "folder")]

        if not mark_seen:
            args.append("--preview")

        body = himalaya.run(
            args, account=_account(account), json_out=False, positional=[himalaya.safe_id(message_id)]
        )
    except himalaya.MailError as error:
        return str(error)

    text = body if isinstance(body, str) else str(body)

    # Himalaya renders "undefined" when a message has no text/plain part
    # (HTML-only newsletters). Parse the raw MIME ourselves in that case.
    stripped = text.strip()
    body_only = stripped.split("\n\n", 1)[-1].strip() if "\n\n" in stripped else stripped

    if body_only in ("", "undefined"):
        parsed = _read_raw_body(message_id, folder, account)

        if parsed:
            headers = stripped.split("\n\n", 1)[0] if "\n\n" in stripped else ""
            text = f"{headers}\n\n{parsed}".strip()

    if len(text) > MAX_BODY_CHARS:
        return text[:MAX_BODY_CHARS] + f"\n\n[... truncated, {len(text)} chars total]"

    return text or "(empty message)"


def mail_search(query: str, folder: str = "INBOX", limit: int = DEFAULT_PAGE_SIZE, account: str | None = None) -> str:
    """Search with Himalaya's filter grammar.

    Conditions: date/before/after <yyyy-mm-dd>, from/to/subject/body <pattern>,
    flag <flag>. Combine with and/or/not, optionally `order by date desc`.
    """
    if not query.strip():
        return (
            "Provide a query, e.g. 'from dana', 'subject invoice', 'not flag seen', "
            "'after 2026-07-01 and from ato'."
        )

    size = max(1, min(int(limit or DEFAULT_PAGE_SIZE), 100))

    try:
        data = himalaya.run(
            ["envelope", "list", "-f", himalaya.safe_name(folder, "folder"), "-s", str(size)],
            account=_account(account),
            # shlex keeps quoted phrases intact ('subject "invoice 42"');
            # str.split would shred them into three bogus terms.
            positional=shlex.split(query),
        )
    except (himalaya.MailError, ValueError) as error:
        return str(error)

    if not isinstance(data, list) or not data:
        return f"No matches for '{query}' in {folder}."

    return "\n".join(_fmt_envelope(env) for env in data if isinstance(env, dict))


def mail_move(message_id: str, target_folder: str, folder: str = "INBOX", account: str | None = None) -> str:
    if not str(message_id).strip() or not target_folder.strip():
        return "Provide both the message id and the target folder."

    try:
        himalaya.run(
            ["message", "move", "-f", himalaya.safe_name(folder, "folder")],
            account=_account(account),
            json_out=False,
            positional=[himalaya.safe_name(target_folder, "target folder"), himalaya.safe_id(message_id)],
        )
    except himalaya.MailError as error:
        return str(error)

    return f"Moved message {message_id} from {folder} to {target_folder}."


def mail_flag(message_id: str, flag: str, remove: bool = False, folder: str = "INBOX",
              account: str | None = None) -> str:
    """Add/remove an IMAP flag (Seen, Flagged, Answered, Draft)."""
    clean = flag.strip().capitalize()

    if clean not in {"Seen", "Flagged", "Answered", "Draft"}:
        return (
            "Flag must be one of: Seen, Flagged, Answered, Draft. Deleting mail is not available to "
            "the agent — ask the user to delete it in their mail app."
        )

    action = "remove" if remove else "add"

    try:
        himalaya.run(
            ["flag", action, "-f", himalaya.safe_name(folder, "folder")],
            account=_account(account),
            json_out=False,
            positional=[himalaya.safe_id(message_id), clean],
        )
    except himalaya.MailError as error:
        return str(error)

    return f"{'Removed' if remove else 'Added'} flag {clean} on message {message_id}."


def _header_safe(value: str, field: str) -> str:
    """Reject CR/LF in a header value.

    Without this a subject like "Q3\\nBcc: attacker@evil.com" injects a hidden
    recipient AND renders identically to the approval prompt's own lines — the
    user approves a mail to their boss and a stranger receives it too.
    """
    text = str(value)

    if "\r" in text or "\n" in text or "\x00" in text:
        raise ValueError(f"{field} must be a single line (no newlines).")

    return text.strip()


def _compose(to: str, subject: str, body: str, cc: str = "", bcc: str = "") -> str:
    headers = [f"To: {_header_safe(to, 'Recipient')}", f"Subject: {_header_safe(subject, 'Subject')}"]

    if cc.strip():
        headers.append(f"Cc: {_header_safe(cc, 'Cc')}")

    if bcc.strip():
        headers.append(f"Bcc: {_header_safe(bcc, 'Bcc')}")

    return "\n".join(headers) + "\n\n" + body


def mail_draft(to: str, subject: str, body: str, cc: str = "", bcc: str = "",
               account: str | None = None) -> str:
    """Save a draft — reversible, so no approval gate; the user reviews it in their mail app."""
    if not to.strip():
        return "Provide at least one recipient."

    try:
        raw = _compose(to, subject, body, cc, bcc)

        himalaya.run(["message", "save", "-f", "drafts"], account=_account(account), json_out=False, stdin_text=raw)
    except (himalaya.MailError, ValueError) as error:
        return str(error)

    return f"Draft saved to Drafts — To: {to}, Subject: {subject}. The user can review and send it."


def mail_send(to: str, subject: str, body: str, cc: str = "", bcc: str = "", account: str | None = None,
              approval_callback=None) -> str:
    """Send mail. ALWAYS gated by the human approval prompt (fails closed)."""
    if not to.strip():
        return "Provide at least one recipient."

    from tools.approval import request_tool_approval

    try:
        raw = _compose(to, subject, body, cc, bcc)
    except ValueError as error:
        return str(error)

    preview = body.strip()
    preview = preview[:400] + ("…" if len(preview) > 400 else "")
    reason = (
        f"Send email as {account or 'the default account'}\n"
        f"  To: {to}\n"
        + (f"  Cc: {cc}\n" if cc.strip() else "")
        + (f"  Bcc: {bcc}\n" if bcc.strip() else "")
        + f"  Subject: {subject}\n"
        f"  Body: {preview}"
    )

    # No rule_key on purpose: the gate then derives the allowlist key from
    # tool + a hash of THIS reason, so an "always" answer can never
    # pre-approve a different recipient/subject/body.
    decision = request_tool_approval(
        "mail_send",
        reason,
        approval_callback=approval_callback,
    )

    if not decision.get("approved"):
        return decision.get("message") or "Sending was not approved — nothing was sent."

    try:
        himalaya.run(["message", "send"], account=_account(account), json_out=False,
                     timeout=himalaya.SEND_TIMEOUT_S, stdin_text=raw)
    except himalaya.MailError as error:
        return str(error)

    return f"Sent — To: {to}, Subject: {subject}. A copy is in the Sent folder."
