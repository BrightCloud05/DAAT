"""Recall: the agent answers from the user's notes without being asked to.

Daat's premise is that the vault is a second memory. A second memory that is
only consulted when the model remembers to call vault_search is not a memory —
it is a lottery, and a quiet one: when the model skips the search it answers
from nothing and sounds exactly as sure of itself.

So the search happens before every turn, in pre_llm_call, and these pin the
parts that decide whether it is useful or merely expensive.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from plugins.vault import context_bridge


@pytest.fixture
def vault(tmp_path, monkeypatch):
    """A vault with a few notes, wired up the way the desktop wires one."""
    home = tmp_path / "home"
    root = tmp_path / "vault"
    (home / "state").mkdir(parents=True)
    (root / "Projects").mkdir(parents=True)

    (root / "Projects" / "Pricing.md").write_text(
        "# Pricing\n\nWe settled on 69 dollars one-off, decided in July.\n", encoding="utf-8"
    )
    (root / "Projects" / "Roadmap.md").write_text(
        "# Roadmap\n\nGraph view ships before the table views.\n", encoding="utf-8"
    )
    (root / "Groceries.md").write_text("# Groceries\n\nmilk, eggs\n", encoding="utf-8")
    (root / "Projects" / "회의록.md").write_text(
        "# 회의록\n\n가격 정책은 월 29달러로 정했다. 환불은 14일 이내.\n", encoding="utf-8"
    )

    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("VAULT_PATH", str(root))

    return root


def _context(**kwargs) -> str:
    result = context_bridge.pre_llm_call(**kwargs)

    return result["context"] if result else ""


def test_a_question_pulls_in_the_note_that_answers_it(vault):
    context = _context(user_message="what did we decide about the pricing page?")

    assert "Pricing.md" in context, context
    # And it carries enough of the line to be worth reading.
    assert "69" in context, context


def test_unrelated_notes_stay_out_of_the_prompt(vault):
    context = _context(user_message="what did we decide about the pricing page?")

    assert "Groceries.md" not in context, "recall must be about the question, not the vault"


def test_filler_words_are_not_searched(vault):
    # "about"/"what"/"the" match half the vault and would drown the real hit.
    assert "about" not in context_bridge._terms("what did we decide about the pricing page")
    assert "pricing" in context_bridge._terms("what did we decide about the pricing page")


def test_a_greeting_costs_nothing(vault):
    # Recall runs before EVERY turn, so "ok" must not fan out into searches.
    assert context_bridge._recall("ok") == []
    assert context_bridge._recall("고마워") == []


def test_recall_survives_having_no_note_open(vault):
    # Most chat happens away from the editor; the bridge file may not exist at
    # all. Recall is the part that must still work.
    context = _context(user_message="remind me about the roadmap ordering")

    assert "Roadmap.md" in context, context


def test_recall_survives_a_stale_bridge(vault):
    stale = {"active_note": "Old.md", "vault": str(vault), "updated_at": (time.time() - 3600) * 1000}
    bridge = Path(context_bridge._bridge_path())
    bridge.write_text(json.dumps(stale), encoding="utf-8")

    context = _context(user_message="remind me about the roadmap ordering")

    assert "Old.md" not in context, "a stale open-note claim must not be presented as current"
    assert "Roadmap.md" in context, "but dropping recall with it is how it answers from nothing"


def test_the_injected_block_stays_small(vault):
    for index in range(40):
        (vault / f"Pricing note {index}.md").write_text(f"# {index}\n\npricing detail\n", encoding="utf-8")

    context = _context(user_message="pricing")

    assert context.count("Pricing") <= context_bridge.MAX_RECALL_NOTES + 2, context[:400]
    assert len(context) < 4_000, f"{len(context)} chars would crowd out the conversation"


def test_a_broken_vault_does_not_break_the_turn(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "nowhere"))
    monkeypatch.setenv("VAULT_PATH", str(tmp_path / "missing"))

    # No vault, no bridge, nothing to read: the turn proceeds without context
    # rather than raising into the user's conversation.
    assert context_bridge.pre_llm_call(user_message="anything at all") is None


def test_korean_recall_finds_the_note(vault):
    """The vault is a second memory in whatever language the user writes in.

    Korean content nouns are routinely two syllables — 가격, 정책, 회의, 일정 —
    and the tokenizer had a flat three-character floor. So every one of them was
    discarded and only the grammar words survived: "가격 정책 어떻게 정했지?"
    reduced to ['어떻게', '정했지'], which a literal `rg -F` search can never
    match. Recall returned nothing on every Korean turn, and returned it
    silently: the model then answered from nothing, exactly as confidently.
    """
    assert context_bridge._recall("가격 정책 어떻게 정했지?"), "no Korean note was recalled"
    assert any("회의록" in note for note in context_bridge._recall("가격 정책 어떻게 정했지?"))


def test_korean_terms_are_the_nouns_not_the_grammar(vault):
    assert context_bridge._terms("가격 정책 어떻게 정했지?") == ["가격", "정책"]
    assert context_bridge._terms("환불 정책 정리해줘") == ["환불", "정책"]


def test_particles_are_stripped_so_a_literal_search_can_match(vault):
    # The note says "가격 정책은" — a substring search for "회의에서" finds
    # nothing, because nobody writes the bare noun in a sentence.
    assert "회의" in context_bridge._terms("지난주 회의에서 가격 관련해서 뭐라고 했더라")


def test_english_recall_is_unchanged(vault):
    assert any("Pricing" in note for note in context_bridge._recall("what did I decide about the pricing page"))


def test_the_agent_is_told_what_the_vault_is_on_day_one(tmp_path, monkeypatch):
    """An empty vault is exactly when the agent most needs to know it has one.

    pre_llm_call used to return None when nothing was open and nothing was
    recalled — so on a machine set up an hour ago, with an empty vault, the
    agent was told nothing about the vault at all. It only learned the vault
    existed once the vault already contained something matching, which is the
    wrong way round: day one is when there is nothing in there, and when the
    habit of writing things down has to start.
    """
    home, root = tmp_path / "home", tmp_path / "vault"
    (home / "state").mkdir(parents=True)
    root.mkdir(parents=True)

    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("VAULT_PATH", str(root))

    result = context_bridge.pre_llm_call(user_message="안녕, 오늘 뭐 하면 좋을까?")

    assert result is not None, "the agent was told nothing about its own vault"

    context = result["context"]

    assert "second brain" in context
    assert "vault_search" in context and "vault_write" in context


def test_the_standing_line_is_there_alongside_real_recall(vault):
    """Recall adds to the standing instruction; it does not replace it."""
    result = context_bridge.pre_llm_call(user_message="what did I decide about the pricing page")

    assert result is not None

    context = result["context"]

    assert "Pricing.md" in context, context
    assert "second brain" in context


def test_the_standing_line_is_stable(vault):
    """It is prepended to every turn, so it has to be cache-friendly.

    A line that varies per turn would invalidate the prompt cache on every
    single message — the standing instruction has to be the same bytes.
    """
    first = context_bridge.pre_llm_call(user_message="a question about something")
    second = context_bridge.pre_llm_call(user_message="a different question entirely")

    assert context_bridge.STANDING_INSTRUCTION in (first or {})["context"]
    assert context_bridge.STANDING_INSTRUCTION in (second or {})["context"]
