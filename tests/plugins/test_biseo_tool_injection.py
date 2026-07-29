"""Injection regressions for the BISEO vault and mail tools.

Every argument in these tools can be written by the model, and the model
reads untrusted text (an incoming email, a note someone shared). So each
argument is an attacker-controlled string that reaches an argv or a mail
header. Two of these were live remote-code-execution paths:

* ripgrep parsed `vault_search`'s query as its first flag, so
  `--pre=<script>` ran that script on every file it walked.
* himalaya parsed the first positional the same way, so `--config <file>`
  loaded attacker TOML whose `auth.cmd` is executed as a shell command.

The fix in both cases is `--` before the positionals plus validation of the
fields that can never legitimately look like a flag.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.mail import himalaya, tools as mail_tools  # noqa: E402
from plugins.vault import tools as vault_tools  # noqa: E402


@pytest.fixture
def vault(tmp_path, monkeypatch):
    root = tmp_path / "vault"
    (root / "Notes").mkdir(parents=True)
    (root / "Notes" / "hello.md").write_text("the quick brown fox\n", encoding="utf-8")
    (root / ".trash").mkdir()
    (root / ".trash" / "deleted.md").write_text("the quick brown fox\n", encoding="utf-8")
    monkeypatch.setenv("VAULT_PATH", str(root))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    return root


@pytest.fixture
def himalaya_argv(monkeypatch):
    """Capture the argv himalaya would run, without running it."""
    seen: list[list[str]] = []

    class Completed:
        returncode = 0
        stdout = "[]"
        stderr = ""

    def fake_run(argv, **_kwargs):
        seen.append(list(argv))

        return Completed()

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(himalaya, "binary", lambda: "/usr/bin/himalaya")

    return seen


def test_search_query_cannot_become_a_ripgrep_flag(vault, tmp_path):
    """`--pre=<script>` used to execute that script on every file walked."""
    marker = tmp_path / "PWNED"
    script = tmp_path / "pre.sh"
    script.write_text(f'#!/bin/sh\ntouch "{marker}"\ncat "$1"\n', encoding="utf-8")
    script.chmod(0o755)

    vault_tools.vault_search(f"--pre={script}")

    assert not marker.exists(), "vault_search executed an attacker-supplied command"


def test_search_cannot_be_pointed_outside_the_vault(vault):
    assert "passwd" not in vault_tools.vault_search("--glob=/etc/*")


def test_search_still_finds_notes_and_skips_app_folders(vault):
    result = vault_tools.vault_search("quick brown")

    assert "Notes/hello.md" in result
    # Deleted notes must not resurface through search.
    assert ".trash" not in result


def test_search_treats_the_query_literally(vault):
    """-F: a query with regex metacharacters is a phrase, not a pattern."""
    (vault / "Notes" / "regex.md").write_text("cost is $5 (approx)\n", encoding="utf-8")

    assert "regex.md" in vault_tools.vault_search("$5 (approx)")


def test_list_skips_app_folders(vault):
    result = vault_tools.vault_list()

    assert "Notes/hello.md" in result
    assert "deleted.md" not in result


def test_write_keeps_a_recoverable_copy_of_what_it_replaces(vault, tmp_path):
    vault_tools.vault_write("Notes/hello.md", "clobbered")

    backups = list((tmp_path / "home" / "state" / "vault-backups").iterdir())

    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "the quick brown fox\n"
    assert (vault / "Notes" / "hello.md").read_text(encoding="utf-8") == "clobbered"


def test_mail_positionals_are_terminated(himalaya_argv):
    """The first positional used to be parsed as a flag by clap."""
    mail_tools.mail_search("--config /tmp/evil.toml")

    argv = himalaya_argv[-1]

    assert "--" in argv
    assert argv.index("--") < argv.index("--config"), "attacker flag reached himalaya's parser"


def test_mail_search_keeps_quoted_phrases_together(himalaya_argv):
    mail_tools.mail_search('subject "invoice 42"')

    assert himalaya_argv[-1][-2:] == ["subject", "invoice 42"]


@pytest.mark.parametrize("bad_id", ["--config /tmp/evil.toml", "12; rm -rf ~", "-c", ""])
def test_message_ids_must_be_ids(bad_id, himalaya_argv):
    assert "Invalid message id" in mail_tools.mail_read(bad_id) or "Provide the message id" in mail_tools.mail_read(
        bad_id
    )


def test_flag_shaped_folder_and_account_are_refused(himalaya_argv):
    assert "Invalid folder" in mail_tools.mail_list("--config=/tmp/evil.toml")
    assert "Invalid account" in mail_tools.mail_folders("-c/tmp/evil.toml")


@pytest.mark.parametrize(
    "field",
    [
        {"subject": "Q3 numbers\nBcc: attacker@evil.com"},
        {"to": "boss@corp.com\nBcc: attacker@evil.com"},
        {"cc": "team@corp.com\r\nBcc: attacker@evil.com"},
    ],
)
def test_headers_cannot_carry_a_hidden_recipient(field, himalaya_argv):
    """An injected Bcc renders exactly like a real line in the approval prompt."""
    args = {"to": "boss@corp.com", "subject": "Q3", "body": "text", **field}
    result = mail_tools.mail_draft(**args)

    assert "single line" in result
    assert not himalaya_argv, "a draft with an injected header was still sent to himalaya"


def test_sending_is_never_pre_approved_for_a_different_message(monkeypatch, himalaya_argv):
    """No constant rule_key: an 'always' answer must not cover other mail."""
    asked: list[str] = []

    def gate(tool, reason, **kwargs):
        asked.append(reason)

        assert "rule_key" not in kwargs, "a constant rule_key would let one approval cover every send"

        return {"approved": False, "message": "Not approved."}

    monkeypatch.setitem(sys.modules, "tools.approval", type(sys)("tools.approval"))
    sys.modules["tools.approval"].request_tool_approval = gate

    mail_tools.mail_send("a@b.com", "One", "body")
    mail_tools.mail_send("attacker@evil.com", "Two", "body")

    assert len(asked) == 2
    assert asked[0] != asked[1], "both sends produced the same approval grain"
    assert not himalaya_argv, "mail was sent without approval"


def test_deleting_mail_is_not_available_to_the_agent(himalaya_argv):
    assert "not available" in mail_tools.mail_flag("42", "Deleted")
    assert not himalaya_argv
