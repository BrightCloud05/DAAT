"""Mail tool implementations.

Read/organize operations run directly. The two outward-facing actions —
sending mail and moving/deleting messages — are different in kind: sending
is irreversible and speaks as the user, so `mail_send` always goes through
the human approval gate (`request_tool_approval`), which fails CLOSED when
no human can answer.
"""

from __future__ import annotations

import re
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


def _export_eml(message_id: str, folder: str, account: str | None) -> bytes | None:
    """The whole message as it arrived, headers and all.

    Split out from _read_raw_body because that function returns only the
    decoded BODY — every RFC-5322 header discarded. mail_reply was searching
    that body for From/Message-ID/References and finding nothing, so no reply
    it ever drafted was threaded or addressed. Headers have to come from here.

    Raw bytes rather than a parsed message: `policy.default` parses headers
    LAZILY, so a message that blows up on .get() parses fine here and explodes
    somewhere else entirely. Both consumers parse it themselves, each able to
    handle its own failures.
    """
    import tempfile
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
            return target.read_bytes()
        except OSError:
            return None


# The only headers a reply needs. Anything else is the sender's business.
_REPLY_HEADERS = ("From", "Reply-To", "To", "Cc", "Subject", "Message-ID", "References")


def _one_line(value: str) -> str:
    """A header value that cannot be anything but one line.

    Whitespace collapsing alone is not enough: `'\\x00'.isspace()` is False, so a
    NUL smuggled in through an encoded word survived `' '.join(split())` and
    tripped _header_safe three functions later — which then blamed a newline
    that was not there, sending the user looking for the wrong thing.
    """
    return " ".join(re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", value).split())


def header_block(raw: bytes) -> str:
    """Decoded, unfolded headers as a plain block, for plugins/mail/reply.py.

    Two things this does that a search over the whole message cannot:

    - `policy.default` decodes RFC 2047, so a Korean or accented subject is
      real text instead of `=?UTF-8?B?…?=` quoted verbatim into "Re: ".
    - It emits ONLY headers, terminated by a blank line. Handing reply.py a
      whole message meant its header search ran over the body too, and a
      forwarded mail carries the original sender's `From:` in there — so the
      draft could be addressed to the wrong person entirely.

    Every lookup is guarded, and that is not defensive habit. `policy.default`
    parses address headers lazily and REFUSES one whose decoded display name
    contains CR or LF — which any sender can plant with an encoded word. That
    ValueError escaped the tool boundary and put a Python traceback in front of
    the user, and the message became permanently unreplyable. Falling back to
    the undecoded value costs a pretty display name; raising costs the reply.
    """
    import email
    from email import policy

    try:
        decoded = email.message_from_bytes(raw, policy=policy.default)
    except Exception:  # noqa: BLE001 — malformed MIME; compat32 still reads it
        decoded = None

    # compat32 never decodes and never raises: the floor under the nice path.
    plain = email.message_from_bytes(raw)
    lines = []

    for name in _REPLY_HEADERS:
        value = None

        if decoded is not None:
            try:
                value = decoded.get(name)
            except Exception:  # noqa: BLE001 — hostile encoded word
                value = None

        if value is None:
            # The undecoded source. For an address header that means keeping
            # the encoded word — which would be decoded again, and refused
            # again, the moment EmailMessage parses it into the draft. So take
            # the addresses and drop the display name: a reply addressed to
            # `dana@example.com` with no pretty name still reaches Dana, and a
            # reply that cannot be composed reaches nobody.
            raw_value = plain.get(name)

            if raw_value and name in ("From", "Reply-To", "To", "Cc"):
                import email.utils

                addresses = [addr for _, addr in email.utils.getaddresses([str(raw_value)]) if addr]
                value = ", ".join(addresses)
            else:
                value = raw_value

        if value:
            lines.append(f"{name}: {_one_line(str(value))}")

    return "\n".join(lines) + "\n\n"


def _body_text(raw: bytes | None) -> str | None:
    """Readable text from a raw message: the plain part, else HTML converted."""
    import email
    from email import policy

    if not raw:
        return None

    try:
        message = email.message_from_bytes(raw, policy=policy.default)
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


def _read_raw_body(message_id: str, folder: str, account: str | None) -> str | None:
    """Fallback for HTML-only mail: export the raw .eml and parse it ourselves."""
    return _body_text(_export_eml(message_id, folder, account))


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
            # ONE argument, not shlex words. himalaya parses the query itself
            # and re-joins argv with spaces, so splitting here stripped the very
            # quotes that made 'subject "invoice 42"' parse — and the resulting
            # syntax error exits 0, which used to read as "No matches".
            positional=[query.strip()],
        )
    except (himalaya.MailError, ValueError) as error:
        return str(error)

    if not isinstance(data, list) or not data:
        return f"No matches for '{query}' in {folder}."

    return "\n".join(_fmt_envelope(env) for env in data if isinstance(env, dict))


# Folder names that mean "on its way to being deleted", in the aliases himalaya
# resolves and in the raw names people use.
_TRASHY = ("trash", "deleted", "bin", "휴지통", "쓰레기")


def mail_move(message_id: str, target_folder: str, folder: str = "INBOX", account: str | None = None,
              approval_callback=None) -> str:
    if not str(message_id).strip() or not target_folder.strip():
        return "Provide both the message id and the target folder."

    # Archiving is reversible and stays ungated. Trash is not: Gmail purges it
    # after thirty days, and mail_flag told the user in as many words that the
    # agent could not delete their mail — while this path could, on nothing
    # more than a sentence inside an email the agent had just read.
    if any(word in target_folder.lower() for word in _TRASHY):
        from tools.approval import request_tool_approval

        # No rule_key, for the same reason mail_send omits one: the gate then
        # keys any "always" answer to THIS reason, so approving one trash move
        # can never pre-approve a different message.
        decision = request_tool_approval(
            "mail_move",
            f"Move message {message_id} from {folder} to {target_folder} — this is the trash folder",
            approval_callback=approval_callback,
        )

        if not decision.get("approved"):
            return decision.get("message") or f"Not moved: trashing message {message_id} was not approved."

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
            "Flag must be one of: Seen, Flagged, Answered, Draft. Setting the Deleted flag is not "
            "available to the agent; moving a message to trash with mail_move asks the user first."
        )

    action = "remove" if remove else "add"

    try:
        himalaya.run(
            ["flag", action, "-f", himalaya.safe_name(folder, "folder")],
            account=_account(account),
            json_out=False,
            # Split, because himalaya reads "every argument that parses as an
            # integer" as an id and everything else as a flag name — so the one
            # string "105,107" was taken as a FLAG, the id list came out empty,
            # nothing was touched, and it exited 0 with a cheerful confirmation
            # naming the ids it had not flagged.
            positional=[*himalaya.safe_id(message_id).split(","), clean],
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


def _compose(to: str, subject: str, body: str, cc: str = "", bcc: str = "",
             extra: dict[str, str] | None = None) -> str:
    """A message the rest of the world can read.

    Built with the email library rather than string concatenation, and the
    difference is not tidiness. Concatenation wrote decoded UTF-8 straight into
    header fields — which RFC 5322 forbids outright — and emitted no
    MIME-Version and no Content-Type, so a message with no declared charset
    defaults to us-ascii and every Korean draft, reply and SENT mail arrived as
    mojibake. Round-tripping one back through this module's own reader was
    enough to show it. For a product whose first users write in Korean, that is
    every message.

    EmailMessage RFC 2047-encodes non-ASCII headers, picks a charset and
    transfer encoding for the body, and folds long headers — which also keeps
    a twenty-deep References chain under RFC 5322's 998-octet line limit
    instead of emitting a 1,400-character line for a server to wrap wherever it
    likes, possibly through the middle of a Message-ID.
    """
    from email.message import EmailMessage
    from email.policy import SMTP

    message = EmailMessage(policy=SMTP)

    # _header_safe stays: EmailMessage would happily fold an embedded newline
    # into a legal continuation line, turning "Q3\nBcc: attacker@evil.com" into
    # a real Bcc. The rejection has to happen before the value reaches it.
    message["To"] = _header_safe(to, "Recipient")
    message["Subject"] = _header_safe(subject, "Subject")

    if cc.strip():
        message["Cc"] = _header_safe(cc, "Cc")

    if bcc.strip():
        message["Bcc"] = _header_safe(bcc, "Bcc")

    # Threading headers (In-Reply-To/References). Same CRLF check as the rest:
    # these are attacker-influenced too, since they come from a message someone
    # else wrote.
    for name, value in (extra or {}).items():
        if value.strip():
            message[name] = _header_safe(value, name)

    message.set_content(body)

    return message.as_string()


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


def mail_reply(message_id: str, body: str, folder: str = "INBOX", reply_all: bool = False,
               account: str | None = None, quote_original: bool = True) -> str:
    """Draft a reply that actually threads. Saved to Drafts — never sent.

    Composing a reply by hand with mail_draft produces a message that reads
    correctly and lands in the recipient's client as a NEW conversation, beside
    the one it answers. Nobody sees an error. See plugins/mail/reply.py.
    """
    if not str(message_id).strip():
        return "Provide the message id from mail_list."

    if not body.strip():
        return "Provide the reply body."

    from . import reply as reply_headers

    original = _export_eml(message_id, folder, account)

    if original is None:
        return f"Could not read message {message_id} in {folder}; nothing to reply to."

    try:
        # Headers from the header block, body from the MIME walk. Passing the
        # body to both is what made every reply unthreaded and unaddressed.
        #
        # All of it inside the try: every other failure in this module answers
        # the model in prose, and a stranger's message must not be able to put
        # a stack trace here instead.
        headers = header_block(original)

        to, cc = reply_headers.reply_recipients(headers, reply_all=reply_all)

        if not to:
            return "The original message has no From or Reply-To address."

        in_reply_to, references = reply_headers.reply_references(headers)
        subject = reply_headers.reply_subject(reply_headers.header(headers, "Subject"))
        text = body.rstrip()

        if quote_original:
            # The decoded text, not the raw bytes after the first blank line —
            # which for any multipart message is MIME boundaries and base64.
            text += reply_headers.quote(_body_text(original) or "", reply_headers.header(headers, "From"))

        composed = _compose(
            to, subject, text, cc,
            extra={"In-Reply-To": in_reply_to, "References": references},
        )

        himalaya.run(["message", "save", "-f", "drafts"], account=_account(account), json_out=False,
                     stdin_text=composed)
    except (himalaya.MailError, ValueError) as error:
        return str(error)
    except Exception as error:  # noqa: BLE001 — the .eml is a stranger's input
        return f"Could not build a reply to message {message_id}: {error}"

    threaded = "threaded under the original" if in_reply_to else "NOT threaded (the original had no Message-ID)"

    return f"Reply draft saved to Drafts — To: {to}, Subject: {subject}, {threaded}. Review and send it yourself."


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
