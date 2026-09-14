"""Filing has to happen whether or not the model remembers to do it.

Recall was already mechanical — context_bridge searches the vault before every
turn. Filing was a request in the system prompt, so when the model forgot, the
decision the user assumed was written down simply was not, and nothing said so.

These pin the half that runs on a schedule instead of a hope.
"""

from __future__ import annotations

import json

import pytest

from plugins.memory.vault import MIN_USER_CHARS, VaultMemoryProvider, _parse_entries, _worth_reviewing


@pytest.fixture
def vault(tmp_path, monkeypatch):
    home = tmp_path / "home"
    root = tmp_path / "vault"
    (home / "state").mkdir(parents=True)
    root.mkdir(parents=True)

    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("VAULT_PATH", str(root))

    return root


def _talk(*pairs: str):
    """A conversation long enough to be worth reviewing."""
    messages = []

    for index, text in enumerate(pairs):
        messages.append({"role": "user" if index % 2 == 0 else "assistant", "content": text})

    return messages


def _stub_model(monkeypatch, payload):
    """The auxiliary model, answering with `payload`."""
    calls = []

    class _Reply:
        def __init__(self, text):
            self.choices = [type("C", (), {"message": type("M", (), {"content": text})()})()]

    class _Client:
        class chat:  # noqa: N801 — mirrors the OpenAI client shape
            class completions:  # noqa: N801
                @staticmethod
                def create(model, messages, **kwargs):
                    calls.append(messages)

                    return _Reply(payload)

    monkeypatch.setattr(
        "agent.auxiliary_client.get_text_auxiliary_client",
        lambda task="", **kw: (_Client(), "aux-model"),
    )

    return calls


def test_a_decision_lands_in_the_vault_without_being_asked(vault, monkeypatch):
    _stub_model(
        monkeypatch,
        json.dumps({"entries": [{"title": "가격 정책", "body": "월 29달러 일회성으로 정했다. 7월 결정."}]}),
    )

    VaultMemoryProvider().on_session_end(
        _talk(
            "가격을 얼마로 할지 정해야 하는데 어떻게 생각해?",
            "몇 가지 안이 있습니다. 일회성 69달러, 구독 월 29달러…",
            "그럼 월 29달러로 가자. 사용자 확보가 먼저야.",
            "알겠습니다. 월 29달러로 진행하겠습니다.",
        )
    )

    notes = list((vault / "Inbox").glob("*.md"))

    assert len(notes) == 1, [str(p) for p in (vault).rglob("*")]

    body = notes[0].read_text(encoding="utf-8")

    assert "가격 정책" in body
    assert "월 29달러" in body


def test_nothing_worth_keeping_writes_nothing(vault, monkeypatch):
    """The common answer. A note nobody needed is worse than no note."""
    _stub_model(monkeypatch, json.dumps({"entries": []}))

    VaultMemoryProvider().on_session_end(
        _talk(
            "이거 어떻게 하는지 알려줘, 좀 길게 물어보는 중이야 " * 3,
            "이렇게 하시면 됩니다. " * 10,
            "고마워 잘 됐어, 그런데 하나만 더 확인해도 될까 싶은데",
            "도움이 되었다니 다행입니다.",
        )
    )

    assert not (vault / "Inbox").exists()


def test_a_trivial_session_never_reaches_the_model(vault, monkeypatch):
    """One aux call per session is the budget; a greeting must not spend it."""
    calls = _stub_model(monkeypatch, json.dumps({"entries": [{"title": "x", "body": "y"}]}))

    VaultMemoryProvider().on_session_end(_talk("안녕", "안녕하세요!"))

    assert calls == []
    assert not (vault / "Inbox").exists()


def test_a_second_session_the_same_day_appends(vault, monkeypatch):
    _stub_model(monkeypatch, json.dumps({"entries": [{"title": "First", "body": "one"}]}))
    VaultMemoryProvider().on_session_end(_talk(*(["a longer message that carries a good deal of real substance in it"] * 4)))

    _stub_model(monkeypatch, json.dumps({"entries": [{"title": "Second", "body": "two"}]}))
    VaultMemoryProvider().on_session_end(_talk(*(["another message with a good deal of real substance in it as well"] * 4)))

    notes = list((vault / "Inbox").glob("*.md"))

    assert len(notes) == 1, "a second session started a second file"

    body = notes[0].read_text(encoding="utf-8")

    assert "First" in body and "Second" in body
    assert body.count("---\ntype: inbox") == 1, "the frontmatter was written twice"


def test_a_model_that_answers_in_prose_files_nothing(vault, monkeypatch):
    """Better to file nothing than to file the model's apology as a note."""
    _stub_model(monkeypatch, "I could not find anything worth saving, sorry!")

    VaultMemoryProvider().on_session_end(_talk(*(["a message with a good deal of real substance in it"] * 4)))

    assert not (vault / "Inbox").exists()


def test_fenced_json_still_parses():
    entries = _parse_entries('Sure:\n```json\n{"entries": [{"title": "T", "body": "B"}]}\n```')

    assert entries == [{"title": "T", "body": "B"}]


def test_an_entry_with_no_body_is_dropped():
    assert _parse_entries(json.dumps({"entries": [{"title": "T", "body": "  "}]})) == []


def test_a_failing_model_never_surfaces(vault, monkeypatch):
    """A background pass must not be able to break the end of a session."""

    def _boom(task="", **kw):
        raise RuntimeError("provider is down")

    monkeypatch.setattr("agent.auxiliary_client.get_text_auxiliary_client", _boom)

    VaultMemoryProvider().on_session_end(_talk(*(["a message with a good deal of real substance in it"] * 4)))


def test_no_vault_means_no_filing_and_no_provider(tmp_path, monkeypatch):
    monkeypatch.delenv("VAULT_PATH", raising=False)

    provider = VaultMemoryProvider()

    assert provider.is_available() is False
    provider.on_session_end(_talk(*(["a message with a good deal of real substance in it"] * 4)))


def test_what_the_agent_remembers_becomes_something_the_user_can_read(vault):
    """The built-in store is ~/.daat/memories/MEMORY.md — invisible by design.

    Mirroring it means a fact the agent decided to keep about the user is a note
    they can open, correct, or delete, like everything else in their vault.
    """
    VaultMemoryProvider().on_memory_write("add", "user", "Joseph은 한국어로 쓴다.")

    notes = list((vault / "Inbox").glob("*.md"))

    assert len(notes) == 1
    assert "한국어로 쓴다" in notes[0].read_text(encoding="utf-8")


def test_a_deletion_is_not_mirrored_as_a_new_note(vault):
    VaultMemoryProvider().on_memory_write("remove", "user", "something old")

    assert not (vault / "Inbox").exists()


def test_worth_reviewing_needs_more_than_one_turn():
    assert _worth_reviewing(_talk("hi", "hello")) is False
    assert _worth_reviewing(_talk(*(["a message with a good deal of real substance in it"] * 4))) is True


def test_the_substance_floor_is_low_enough_for_korean():
    """The floor counts characters, and Korean says far more per character.

    A real Korean exchange — two questions and their answers — has to clear it.
    Setting it at an English-sized number would silently skip filing for the
    users this product is aimed at first.
    """
    korean = _talk(
        "가격을 얼마로 할지 정해야 하는데 어떻게 생각해?",
        "몇 가지 안이 있습니다. 일회성 69달러, 구독 월 29달러…",
        "그럼 월 29달러로 가자. 사용자 확보가 먼저야.",
        "알겠습니다. 월 29달러로 진행하겠습니다.",
    )

    assert _worth_reviewing(korean) is True, f"floor is {MIN_USER_CHARS} chars"
