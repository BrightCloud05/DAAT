"""DAAT data-boundary contracts, using real modules and temporary files only."""

import json
import wave
from datetime import datetime
from pathlib import Path

import pytest


@pytest.fixture
def vault(tmp_path, monkeypatch):
    root = tmp_path / "vault"
    root.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("VAULT_PATH", str(root))
    return root


def test_unicode_and_repeated_writes_preserve_every_backup(vault, tmp_path, monkeypatch):
    from plugins.vault import tools
    monkeypatch.setattr(tools.time, "strftime", lambda *args: "same-second")
    (vault / "가.md").write_text("first A", encoding="utf-8")
    (vault / "나.md").write_text("first B", encoding="utf-8")
    tools.vault_write("가.md", "second A")
    tools.vault_write("나.md", "second B")
    tools.vault_write("가.md", "third A")
    backups = list((tmp_path / "home/state/vault-backups").iterdir())
    assert {entry.read_text(encoding="utf-8") for entry in backups} == {"first A", "first B", "second A"}


def test_fallback_search_respects_the_same_boundary_as_read(vault, tmp_path, monkeypatch):
    from plugins.vault import tools
    outside = tmp_path / "outside.md"
    outside.write_text("EXTERNAL_SENTINEL", encoding="utf-8")
    (vault / "linked.md").symlink_to(outside)
    (vault / "internal.md").write_text("INTERNAL_SENTINEL", encoding="utf-8")
    def absent(*args, **kwargs):
        raise FileNotFoundError("rg is not installed")
    monkeypatch.setattr(tools.subprocess, "run", absent)
    assert tools.vault_read("linked.md").startswith("Refused")
    result = tools.vault_search("SENTINEL")
    assert "INTERNAL_SENTINEL" in result
    assert "EXTERNAL_SENTINEL" not in result


def test_backup_failure_keeps_the_original_note(vault, monkeypatch):
    from plugins.vault import tools
    target = vault / "Note.md"
    target.write_text("original", encoding="utf-8")
    original_open = Path.open
    def refuse_backup(self, mode="r", *args, **kwargs):
        if mode == "xb":
            raise OSError("backup storage unavailable")
        return original_open(self, mode, *args, **kwargs)
    monkeypatch.setattr(Path, "open", refuse_backup)
    assert tools.vault_write("Note.md", "replacement").startswith("Could not write")
    assert target.read_text(encoding="utf-8") == "original"


def test_filing_appends_to_the_full_note_not_its_preview(vault):
    from plugins.memory.vault import _append_to_inbox
    from plugins.vault.tools import MAX_READ_CHARS
    target = vault / "Inbox/2026-09-14.md"
    target.parent.mkdir()
    original = "# Existing\n" + "a" * (MAX_READ_CHARS + 5000) + "\nIMPORTANT_TAIL\n"
    target.write_text(original, encoding="utf-8")
    assert _append_to_inbox([{"title": "Decision", "body": "The new decision"}], now=datetime(2026, 9, 14))
    result = target.read_text(encoding="utf-8")
    assert result.startswith(original.rstrip())
    assert "The new decision" in result
    assert "[... truncated" not in result


def test_digest_keeps_the_latest_decision_within_its_budget():
    from plugins.memory.vault import _digest, MAX_DIGEST_CHARS
    messages = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"M{i:02d} " + "a" * 1190}
                for i in range(40)]
    messages[-2]["content"] = "FINAL_USER_DECISION " + "b" * 1190
    result = _digest(messages)
    assert "FINAL_USER_DECISION" in result
    assert "M39" in result
    assert result.index("FINAL_USER_DECISION") < result.index("M39")
    assert len(result) <= MAX_DIGEST_CHARS


def test_memory_discovers_the_live_bridge_and_keeps_its_session_vault(vault, tmp_path, monkeypatch):
    from plugins.memory import load_memory_provider
    monkeypatch.delenv("VAULT_PATH")
    bridge = tmp_path / "home/state/vault-context.json"
    bridge.parent.mkdir(parents=True)
    bridge.write_text(json.dumps({"vault": str(vault)}), encoding="utf-8")
    provider = load_memory_provider("vault", register_skills=False)
    assert provider is not None and provider.is_available()
    provider.initialize("session-a")
    other = tmp_path / "other"
    other.mkdir()
    bridge.write_text(json.dumps({"vault": str(other)}), encoding="utf-8")
    provider.on_memory_write("add", "user", "Belongs to vault A")
    assert any("Belongs to vault A" in note.read_text(encoding="utf-8") for note in vault.glob("Inbox/*.md"))
    assert not list(other.glob("Inbox/*.md"))


def test_mail_requires_a_fresh_review_of_the_complete_payload(vault, monkeypatch):
    from plugins.mail import tools as mail
    from tools import approval
    prompts, sent = [], []
    def human(command, reason, **options):
        prompts.append((reason, options))
        return "always"  # A legacy client must not widen the scope.
    monkeypatch.setattr(approval, "_presence", lambda cb=None: (human, True, False, False))
    monkeypatch.setattr(approval, "_yolo_active", lambda: True)
    monkeypatch.setattr(approval, "is_approved", lambda *args: True)
    monkeypatch.setattr(approval, "_persist_choice", lambda *args: pytest.fail("a send approval must not persist"))
    monkeypatch.setattr(mail.himalaya, "run", lambda args, **kw: sent.append(kw["stdin_text"]))
    common = "x" * 400
    assert mail.mail_send("nobody@example.invalid", "Audit", common + " FIRST_TAIL").startswith("Sent")
    assert mail.mail_send("nobody@example.invalid", "Audit", common + " SECOND_TAIL").startswith("Sent")
    assert len(prompts) == len(sent) == 2
    assert "FIRST_TAIL" in prompts[0][0] and "SECOND_TAIL" in prompts[1][0]
    assert all(not options["allow_session"] and not options["allow_permanent"] for _, options in prompts)


def test_mail_cannot_autoapprove_in_an_unattended_context(vault, monkeypatch):
    from plugins.mail import tools as mail
    from tools import approval
    monkeypatch.setattr(approval, "_presence", lambda cb=None: (None, False, False, False))
    monkeypatch.setattr(approval, "_yolo_active", lambda: True)
    monkeypatch.setattr(mail.himalaya, "run", lambda *args, **kw: pytest.fail("must not send"))
    assert not mail.mail_send("nobody@example.invalid", "Audit", "body").startswith("Sent")


def test_meeting_language_reaches_the_real_stt_dispatch(vault, monkeypatch):
    from plugins.meetings.tools import meeting_transcribe
    from tools import transcription_tools as stt
    target = vault / "meeting.wav"
    with wave.open(str(target), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 16000)
    received = []
    monkeypatch.setattr(stt, "_get_provider", lambda config: "local")
    def model(file_path, model_name, **kwargs):
        received.append(kwargs)
        return {"success": True, "transcript": "한국어 전사", "provider": "local"}
    monkeypatch.setattr(stt, "_transcribe_local", model)
    assert "한국어 전사" in meeting_transcribe("meeting.wav", language="ko")
    assert received[0]["language"] == "ko"
