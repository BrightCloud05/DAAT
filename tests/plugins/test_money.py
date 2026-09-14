"""Money: the numbers the user reconciles their bank against.

Every test here is a way the month note ended up quietly wrong — a real
transaction dropped as a "duplicate", an import reported as saved when nothing
was written, a row that parses back as nothing so its amount vanishes from every
total. Wrong numbers presented with confidence are worse than an error, because
there is nothing for the user to notice.
"""

from __future__ import annotations

import json

import pytest

from plugins.vault import money


@pytest.fixture
def vault(tmp_path, monkeypatch):
    """A vault wired the way the desktop wires one."""
    home = tmp_path / "home"
    root = tmp_path / "vault"
    (home / "state").mkdir(parents=True)
    root.mkdir(parents=True)

    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("VAULT_PATH", str(root))

    return root


def _rows(*items: dict) -> str:
    return json.dumps(list(items))


def _coffee(description: str = "Cafe Grind", amount: float = -4.50) -> dict:
    return {"date": "2026-07-31", "description": description, "category": "Food", "amount": amount}


def _table_rows(note_text: str) -> list[str]:
    return [
        line
        for line in note_text.splitlines()
        if line.startswith("| 2026-")
    ]


def test_two_identical_purchases_on_one_day_both_land(vault):
    """Presence-only dedupe dropped the second and called it a duplicate.

    Two $4.50 coffees at the same cafe on the same day is an ordinary Tuesday,
    not an edge case. The month was short by 4.50 forever, and the tool reported
    "skipped 1 duplicate(s)" — which reads like it did the right thing.
    """
    reply = money.money_add_transactions(_rows(_coffee(), _coffee()))

    note = (vault / "Money" / "2026-07.md").read_text(encoding="utf-8")

    assert len(_table_rows(note)) == 2, note
    assert "Added 2 transaction(s)" in reply


def test_reimporting_the_same_statement_adds_nothing(vault):
    """The property the dedupe exists for, which the count must not break."""
    money.money_add_transactions(_rows(_coffee(), _coffee()))
    reply = money.money_add_transactions(_rows(_coffee(), _coffee()))

    note = (vault / "Money" / "2026-07.md").read_text(encoding="utf-8")

    assert len(_table_rows(note)) == 2, note
    assert "Added 0 transaction(s)" in reply
    assert "skipped 2 duplicate(s)" in reply


def test_a_third_copy_lands_when_the_note_already_holds_two(vault):
    money.money_add_transactions(_rows(_coffee(), _coffee()))
    money.money_add_transactions(_rows(_coffee(), _coffee(), _coffee()))

    note = (vault / "Money" / "2026-07.md").read_text(encoding="utf-8")

    assert len(_table_rows(note)) == 3, note


def test_a_failed_write_is_not_reported_as_a_saved_import(vault, monkeypatch):
    """vault_write reports failure by RETURNING a string, and it was discarded.

    The user drops a statement, the vault closes or the volume goes read-only
    mid-turn, and the tool answers "Added 42 transaction(s)". They file the
    statement. The month is permanently 42 transactions short.
    """
    monkeypatch.setattr(money, "vault_write", lambda rel, content: f"Could not write {rel}: disk full")

    reply = money.money_add_transactions(_rows(_coffee()))

    assert "WRITE FAILED" in reply
    assert "NOT saved" in reply
    assert "Added 1 transaction(s)" not in reply


def test_a_raising_write_does_not_abandon_the_other_months(vault, monkeypatch):
    calls: list[str] = []

    def flaky(rel: str, content: str) -> str:
        calls.append(rel)

        if "2026-07" in rel:
            raise OSError("volume disappeared")

        return f"Wrote {rel} ({len(content)} chars)."

    monkeypatch.setattr(money, "vault_write", flaky)

    reply = money.money_add_transactions(
        _rows(_coffee(), {**_coffee(), "date": "2026-08-02"})
    )

    assert len(calls) == 2, "the August write was never attempted"
    assert "WRITE FAILED" in reply
    assert "Money/2026-08.md" in reply


def test_a_wrapped_merchant_name_stays_on_one_row(vault):
    """A newline in the description split the row, and its amount vanished.

    The stored row then parsed back as nothing, so it was missing from every
    total AND could never match the dedupe key — each re-import silently added
    another broken copy.
    """
    money.money_add_transactions(_rows(_coffee("SQ *THE DAILY GRIND\nSYDNEY AU")))

    note = (vault / "Money" / "2026-07.md").read_text(encoding="utf-8")
    rows = _table_rows(note)

    assert len(rows) == 1, note
    assert "SQ *THE DAILY GRIND SYDNEY AU" in rows[0]
    assert "-4.50" in money.money_summary("2026-07")


def test_a_second_import_keeps_its_rows_inside_the_table(vault):
    """The provenance marker was appended BELOW the table.

    The next import appended after it, so those rows sat past a blank line and
    an HTML comment — outside the table as far as markdown is concerned, and
    rendered as literal pipes anywhere the vault is read as markdown.
    """
    money.money_add_transactions(_rows(_coffee()), source="page-1.pdf")
    money.money_add_transactions(_rows({**_coffee("Rent", -2100.0), "date": "2026-07-18"}), source="page-2.pdf")

    note = (vault / "Money" / "2026-07.md").read_text(encoding="utf-8")
    lines = note.splitlines()
    marker = next(index for index, line in enumerate(lines) if line.startswith("<!--"))
    header = next(index for index, line in enumerate(lines) if line.startswith("| Date"))

    assert marker < header, note

    # Every row is below the header with no blank line breaking the table.
    body = lines[header:]
    assert "" not in [line for line in body if line.strip() == ""] or all(
        line.startswith("|") for line in body if line.strip()
    ), note
    assert len(_table_rows(note)) == 2, note


def test_the_latest_month_is_a_month_and_not_whatever_sorts_last(vault):
    """`sorted()` puts letters after digits, so Money/Budget.md won.

    The agent then reported the budget file's planned figures as actual spend,
    or "0 transaction(s)" for a month with real ones.
    """
    money.money_add_transactions(_rows(_coffee()))

    (vault / "Money" / "Budget.md").write_text(
        "# Budget\n\n| Date | Description | Category | Amount |\n| --- | --- | --- | --- |\n"
        "| 2026-07-01 | Planned rent | Housing | -9999.00 |\n",
        encoding="utf-8",
    )

    summary = money.money_summary()

    assert summary.startswith("2026-07:"), summary
    assert "9999" not in summary


def test_a_month_that_is_a_path_is_refused(vault):
    """`month` is interpolated straight into a path, and the model supplies it."""
    money.money_add_transactions(_rows(_coffee()))
    (vault.parent / "secret.md").write_text("not yours\n", encoding="utf-8")

    assert money.money_summary("../../secret") == "Month must be YYYY-MM."
    assert money.money_summary("2026-07").startswith("2026-07:")
