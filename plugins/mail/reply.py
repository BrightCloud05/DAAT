"""Working out what a reply's headers should say.

A reply that omits ``In-Reply-To`` and ``References`` is not a reply. It is
delivered, it reads correctly, and it arrives in the recipient's client as a
brand-new thread sitting next to the conversation it answers — so the person
who wrote it has no idea anything went wrong, and the person who receives it
assumes they were ignored.

The derivation is pure and lives here so it can be tested without a mail
server, because every part of it is a small decision that is easy to get
subtly wrong: which address actually receives the reply, how many times "Re:"
may appear, and what belongs in the References chain.
"""

from __future__ import annotations

import re

# RFC 5322 caps a References header, and some servers reject very long ones.
# Keeping the first (thread root) and the most recent few is what mail clients
# do; dropping the middle is harmless.
MAX_REFERENCES = 20

# Kept so anything still importing the private name keeps working.
def _header(raw: str, name: str) -> str:
    return header(raw, name)


def header(raw: str, name: str) -> str:
    """One unfolded header value from a raw message, or ''.

    Headers may be folded across lines with leading whitespace; a naive
    line-by-line read returns half a Message-ID and threads nothing.

    The header/body split is CRLF-tolerant on purpose. A real .eml off the wire
    uses \r\n, so a plain "\n\n" search never finds the boundary and the
    search ran over the body as well — where a forwarded message carries the
    original sender's From:, and the reply goes to them instead.
    """
    pattern = re.compile(rf"^{re.escape(name)}:[ \t]*(.*(?:\n[ \t]+.*)*)", re.IGNORECASE | re.MULTILINE)
    found = pattern.search(re.split(r"\r?\n\r?\n", raw.replace("\r\n", "\n"), maxsplit=1)[0])

    if not found:
        return ""

    return " ".join(part.strip() for part in found.group(1).splitlines()).strip()


def reply_subject(original: str) -> str:
    """Prefix with Re: exactly once.

    "Re: Re: Re: Q3 numbers" is a tell that a machine wrote it, and some
    clients keep stacking. Localised prefixes (RE:, Re :, 답장:) count too.
    """
    subject = (original or "").strip()

    while True:
        stripped = re.sub(r"^\s*(re|aw|antw|回复|답장|회신)\s*(\[\d+\])?\s*:\s*", "", subject, flags=re.IGNORECASE)

        if stripped == subject:
            break

        subject = stripped

    return f"Re: {subject}" if subject else "Re:"


def reply_recipients(raw: str, *, reply_all: bool = False) -> tuple[str, str]:
    """(To, Cc) for a reply to this raw message.

    Reply-To wins over From when the sender asked for it — that is the whole
    point of the header, and ignoring it sends the reply to a no-reply address.

    Reply-all keeps the original To and Cc minus the sender, and this function
    deliberately does NOT remove the user's own address: it does not know it.
    The caller does, and dropping the wrong address is worse than a self-copy.
    """
    to = header(raw, "Reply-To") or header(raw, "From")

    if not reply_all:
        return to, ""

    others = [value for value in (header(raw, "To"), header(raw, "Cc")) if value]

    return to, ", ".join(others)


def reply_references(raw: str) -> tuple[str, str]:
    """(In-Reply-To, References) for a reply to this raw message.

    References is the thread's spine: the original's chain plus its own id. A
    reply that sets In-Reply-To but drops References still breaks threading in
    clients that follow the chain rather than the parent.
    """
    message_id = header(raw, "Message-ID")

    if not message_id:
        return "", ""

    chain = [ref for ref in header(raw, "References").split() if ref.startswith("<")]
    chain.append(message_id)

    if len(chain) > MAX_REFERENCES:
        # Keep the root and the tail — the middle is what clients drop too.
        chain = chain[:1] + chain[-(MAX_REFERENCES - 1) :]

    return message_id, " ".join(chain)


def quote(raw_body: str, sender: str, limit: int = 2_000) -> str:
    """The original, quoted, under an attribution line."""
    body = (raw_body or "").strip()

    if not body:
        return ""

    if len(body) > limit:
        body = body[:limit].rstrip() + "\n[…]"

    quoted = "\n".join(f"> {line}" if line else ">" for line in body.splitlines())

    return f"\n\nOn {sender} wrote:\n{quoted}" if sender else f"\n\n{quoted}"
