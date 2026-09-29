"""A reply that does not thread is not a reply.

It sends, it reads correctly, and it lands in the recipient's client as a new
conversation beside the one it answers. Nobody sees an error: the sender thinks
they replied, the recipient thinks they were ignored. So the header derivation
gets pinned here, where it can be checked without a mail server.
"""

from __future__ import annotations

from plugins.mail import reply

RAW = """From: Dana Lee <dana@example.com>
To: joseph@example.com, team@example.com
Cc: finance@example.com
Subject: Q3 numbers
Message-ID: <abc123@example.com>
References: <root@example.com> <second@example.com>
Date: Mon, 4 Aug 2026 09:00:00 +1000

Can you confirm the figures before Friday?
"""


def test_the_reply_points_at_the_message_it_answers():
    in_reply_to, references = reply.reply_references(RAW)

    assert in_reply_to == "<abc123@example.com>"
    # The spine is the original chain PLUS this message — a reply that sets
    # only In-Reply-To still breaks clients that follow References.
    assert references == "<root@example.com> <second@example.com> <abc123@example.com>"


def test_a_message_with_no_id_threads_nothing_rather_than_guessing():
    assert reply.reply_references("Subject: hi\n\nbody") == ("", "")


def test_a_folded_header_is_read_whole():
    # Long ids get folded across lines; half a Message-ID threads nothing and
    # looks like it worked.
    folded = "Message-ID:\n <very.long.id@example.com>\nSubject: x\n\nbody"

    assert reply.reply_references(folded)[0] == "<very.long.id@example.com>"


def test_reply_to_beats_from():
    raw = "From: noreply@example.com\nReply-To: dana@example.com\nMessage-ID: <a@b>\n\nhi"

    assert reply.reply_recipients(raw)[0] == "dana@example.com"


def test_a_plain_reply_goes_to_one_person():
    to, cc = reply.reply_recipients(RAW)

    assert to == "Dana Lee <dana@example.com>"
    assert cc == ""


def test_reply_all_keeps_the_room():
    to, cc = reply.reply_recipients(RAW, reply_all=True)

    assert to == "Dana Lee <dana@example.com>"
    assert "team@example.com" in cc
    assert "finance@example.com" in cc


def test_re_is_added_once_however_many_are_already_there():
    assert reply.reply_subject("Q3 numbers") == "Re: Q3 numbers"
    assert reply.reply_subject("Re: Q3 numbers") == "Re: Q3 numbers"
    assert reply.reply_subject("RE: Re: RE: Q3 numbers") == "Re: Q3 numbers"


def test_localised_and_counted_prefixes_count_too():
    assert reply.reply_subject("답장: 안건") == "Re: 안건"
    assert reply.reply_subject("AW: Zahlen") == "Re: Zahlen"
    assert reply.reply_subject("Re[2]: Q3") == "Re: Q3"


def test_an_empty_subject_still_produces_something_sendable():
    assert reply.reply_subject("") == "Re:"


def test_a_very_long_chain_is_trimmed_from_the_middle():
    refs = " ".join(f"<{index}@x>" for index in range(40))
    raw = f"Message-ID: <last@x>\nReferences: {refs}\n\nbody"

    _, references = reply.reply_references(raw)
    parts = references.split()

    assert len(parts) == reply.MAX_REFERENCES
    assert parts[0] == "<0@x>", "the thread root must survive"
    assert parts[-1] == "<last@x>", "and so must this reply's parent"


def test_the_quote_is_attributed_and_bounded():
    quoted = reply.quote("line one\n\nline two", "Dana Lee <dana@example.com>")

    assert "> line one" in quoted
    assert "Dana Lee" in quoted

    long_quote = reply.quote("x" * 5_000, "someone")

    assert len(long_quote) < 2_500, "a quoted novel is not a reply"
    assert "[…]" in long_quote


# --- mail_reply itself -------------------------------------------------------
#
# Everything above tests reply.py in isolation, against hand-written strings
# that happen to have a "\n\n" header boundary and real headers in them. All of
# it passed while the feature was completely dead, because mail_reply handed
# those functions a string containing ONLY the decoded body — every header
# discarded by _read_raw_body. reply_recipients returned ('', ''), so the tool
# answered "The original message has no From or Reply-To address." every time.
#
# These drive mail_reply end to end against a real .eml.

import pytest

from plugins.mail import tools as mail_tools

# CRLF, because that is what comes off the wire — and a "\n\n" search never
# finds the boundary in it. Subject is RFC 2047 so a non-English one is exercised.
EML = (
    "Return-Path: <bounce@lists.example.com>\r\n"
    "From: Dana Lee <dana@example.com>\r\n"
    "Reply-To: Dana Lee <dana.replies@example.com>\r\n"
    "To: Joseph <joseph@example.com>, Sam <sam@example.com>\r\n"
    "Cc: Team <team@example.com>\r\n"
    "Subject: =?UTF-8?B?7ZqM7J2Y66GdIOyblOqzhOu2gA==?=\r\n"
    "Message-ID: <abc123@example.com>\r\n"
    "References: <root@example.com> <mid@example.com>\r\n"
    "MIME-Version: 1.0\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "\r\n"
    "Friday works for me.\r\n"
    "\r\n"
    "-------- Forwarded message --------\r\n"
    "From: Impostor <impostor@example.com>\r\n"
    "Subject: Re: something else\r\n"
)


@pytest.fixture
def sent(monkeypatch, tmp_path):
    """himalaya, stubbed: export writes the .eml, save captures the draft."""
    drafts: list[str] = []

    def fake_run(args, account=None, json_out=True, positional=None, stdin_text=None, **kwargs):
        if args[:2] == ["message", "export"]:
            target = args[args.index("-d") + 1]
            with open(target, "wb") as handle:
                handle.write(EML.encode("utf-8"))
            return None

        if args[:2] == ["message", "save"]:
            drafts.append(stdin_text or "")
            return None

        return None

    monkeypatch.setattr(mail_tools.himalaya, "run", fake_run)

    return drafts


def _parse(draft: str):
    """The draft as a mail client would see it.

    Parsed, not string-split: the composed message is a real RFC 5322 message
    with CRLF endings, folded headers and RFC 2047 encoded words, and asserting
    on the raw text would pin whichever of those happened to be true today.
    """
    import email
    from email import policy

    return email.message_from_string(draft, policy=policy.default)


def _header_of(draft: str, name: str) -> str:
    return str(_parse(draft).get(name) or "")


def test_a_reply_is_addressed_and_threaded(sent):
    """The three headers that make it a reply rather than a new conversation."""
    result = mail_tools.mail_reply("42", "Friday works.")

    assert len(sent) == 1, result
    draft = sent[0]

    assert "dana.replies@example.com" in _header_of(draft, "To"), draft
    assert _header_of(draft, "In-Reply-To") == "<abc123@example.com>", draft
    assert "<root@example.com>" in _header_of(draft, "References")
    assert "<abc123@example.com>" in _header_of(draft, "References")
    assert "no From or Reply-To" not in result


def test_a_korean_subject_survives_the_round_trip(sent):
    """Decoded from the original, re-encoded into the draft, decoded again here.

    Reading the raw bytes gave "Re: =?UTF-8?B?…?=" quoted verbatim as the new
    subject. Decoding it and then writing it back as raw 8-bit is the opposite
    error — RFC 5322 forbids non-ASCII in a header field, and clients render it
    as "Re: íšŒì..." — so the draft has to carry it as an encoded word and a
    reader has to get the Korean back out.
    """
    mail_tools.mail_reply("42", "네, 좋습니다.")

    draft = sent[0]

    assert "회의록 월계부" in _header_of(draft, "Subject"), draft[:400]
    assert draft.isascii(), "a header or body went out as raw 8-bit"


def test_a_korean_body_is_readable_when_it_comes_back(sent):
    """No MIME-Version and no charset meant a reader defaulted to us-ascii.

    Round-tripped through this module's own reader, a Korean reply came back as
    replacement characters — for a product whose first users write in Korean,
    on every message it ever sent.
    """
    mail_tools.mail_reply("42", "네, 금요일 좋습니다.", quote_original=False)

    parsed = _parse(sent[0])

    assert parsed["MIME-Version"], sent[0][:300]
    assert "네, 금요일 좋습니다." in parsed.get_content()


def test_the_reply_does_not_go_to_a_sender_quoted_in_the_body(sent):
    """A forwarded mail carries someone else's From: in its text.

    With no header/body boundary found, the search ran over the whole message
    and could pick that up — drafting a reply to a person who never wrote to
    the user.
    """
    mail_tools.mail_reply("42", "Thanks.")

    parsed = _parse(sent[0])

    assert "impostor@example.com" not in str(parsed.get("To")), sent[0][:400]
    assert "impostor@example.com" not in str(parsed.get("Cc") or "")


def test_reply_all_keeps_the_original_room(sent):
    mail_tools.mail_reply("42", "Agreed.", reply_all=True)

    cc = _header_of(sent[0], "Cc")

    assert "sam@example.com" in cc, cc
    assert "team@example.com" in cc, cc


def test_the_quote_is_the_readable_body_not_mime_scaffolding(sent):
    mail_tools.mail_reply("42", "Sounds good.", quote_original=True)

    content = _parse(sent[0]).get_content()

    assert "> Friday works for me." in content, content
    assert "Content-Type:" not in content, content
    assert "Content-Transfer-Encoding" not in content


def test_a_hostile_display_name_does_not_take_the_reply_tool_down(sent, monkeypatch):
    """policy.default refuses an address whose decoded display name has CR/LF.

    Any sender can plant one with an encoded word. The parse is LAZY, so the
    export succeeds and the ValueError comes out of `.get()` later — past every
    guard, as a Python traceback in front of the user, and that message becomes
    permanently unreplyable.
    """
    import base64

    payload = base64.b64encode("Dana\r\nBcc: attacker@evil.com".encode()).decode()
    hostile = EML.replace(
        "From: Dana Lee <dana@example.com>",
        f"From: =?utf-8?B?{payload}?= <dana@example.com>",
    ).replace("Reply-To: Dana Lee <dana.replies@example.com>\r\n", "")

    monkeypatch.setattr(mail_tools, "_export_eml", lambda *a, **k: hostile.encode())

    result = mail_tools.mail_reply("42", "Friday works.")

    assert len(sent) == 1, result
    assert "dana@example.com" in _header_of(sent[0], "To")
    # Fail-closed either way: the forged header must never reach the draft.
    assert "attacker@evil.com" not in sent[0]


def test_a_nul_in_a_header_does_not_produce_a_lie_about_newlines(sent, monkeypatch):
    import base64

    payload = base64.b64encode(b"Q3\x00numbers").decode()
    weird = EML.replace(
        "Subject: =?UTF-8?B?7ZqM7J2Y66GdIOyblOqzhOu2gA==?=",
        f"Subject: =?utf-8?B?{payload}?=",
    )

    monkeypatch.setattr(mail_tools, "_export_eml", lambda *a, **k: weird.encode())

    result = mail_tools.mail_reply("42", "Noted.")

    assert "no newlines" not in result, result
    assert len(sent) == 1, result


def test_a_long_thread_does_not_emit_an_illegal_header_line(sent, monkeypatch):
    """RFC 5322 caps a line at 998 octets; twenty Gmail-shaped ids blow past it."""
    ids = " ".join(f"<CAK7LNAR3-jZ{n:03d}aaaaaaaaaaaaaaaaaaaaaaaaaaaa@mail.gmail.com>" for n in range(30))

    long_thread = EML.replace("References: <root@example.com> <mid@example.com>", f"References: {ids}")
    monkeypatch.setattr(mail_tools, "_export_eml", lambda *a, **k: long_thread.encode())

    mail_tools.mail_reply("42", "Still here.")

    longest = max(len(line) for line in sent[0].split("\r\n"))

    assert longest <= 998, f"{longest}-octet line"
