"""Filing the conversation into the vault, as a hook rather than a hope.

Daat's premise is that the vault is a second memory. Half of that was already
mechanical: `plugins/vault/context_bridge.py` searches the vault before every
turn, so recall happens whether or not the model remembers to look.

The other half was not. Filing was a sentence appended to the system prompt
("Use vault_read/vault_write…") and a line in the persona's SOUL asking the
model to write things down unprompted. That is the same lottery the recall hook
was built to end: when the model forgets, nothing is written, and nothing says
so. A month later the vault is missing exactly the decisions the user assumed
it was keeping — and there is no error to notice, only an absence.

So filing runs here, at session end, on a schedule the model does not control.

WHY A MEMORY PROVIDER AND NOT A PLUGIN HOOK
`MemoryProvider.on_session_end(messages)` is the sanctioned end-of-session
extraction point (agent/memory_provider.py), already wired into the agent's
lifecycle and already selectable from the Settings screen the user sees as
"Memory Provider". Nothing upstream has to be patched to reach it.

It also closes the gap that made the two memories strangers. hermes' built-in
store lives at ~/.daat/memories/MEMORY.md — real, useful, and invisible to a
user who was promised their notes are plain files they own. `on_memory_write`
mirrors durable facts into the vault, so what the agent decides to remember is
something the user can read, edit and delete like any other note.

WHAT IT DOES NOT DO
It does not guess folders. Everything lands in one dated Inbox note. Filing
into a structure the model invents is how a vault turns into scattered
near-duplicates nobody trusts, and the agent can refile from the Inbox later
with vault_write — which is reviewable, because the user can see it happen.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

# One aux call per session, over a bounded digest. The cost has to be
# invisible or the feature is a tax on every conversation.
MAX_DIGEST_MESSAGES = 40
MAX_MESSAGE_CHARS = 1_200
MAX_DIGEST_CHARS = 24_000
# Below this there is nothing worth a model call: a greeting, a one-liner, a
# session the user abandoned.
#
# Counted over the USER's words only — the assistant's length says nothing
# about whether anything happened — and set low ON PURPOSE. A character
# threshold is a language-dependent threshold. The number below is calibrated
# against a REAL Korean exchange — two questions and the decision they reached
# come to about fifty characters, and an English-sized floor would have skipped
# filing it. The same English calibration is already a live problem elsewhere
# (hermes_cli/config.py:2410, "~800 tokens at 2.75 chars/token"). Erring toward
# reviewing costs one cheap call that usually answers "nothing"; erring the
# other way silently drops the decision the user assumed was written down.
MIN_USER_MESSAGES = 2
MIN_USER_CHARS = 40
# A filing pass that wants to write an essay has misunderstood the job.
MAX_ENTRIES = 5
MAX_ENTRY_CHARS = 2_000

INBOX_DIR = "Inbox"
_inbox_lock = RLock()

_FILING_PROMPT = """You are filing notes into someone's personal vault at the end of a conversation.

Write down only what they would want to find NEXT MONTH and would be annoyed to have lost:
  - a decision, and the reason behind it
  - a fact about them, their work, their people, or their tools
  - a plan, a commitment, a deadline
  - research or an answer that took effort to arrive at

Do NOT write down:
  - what the assistant did, or how the conversation went
  - anything already obviously in the vault
  - chit-chat, greetings, or the fact that a question was asked
  - code the user can regenerate, or output they already have

Most conversations produce nothing worth keeping. Returning an empty list is the
correct and common answer — a note nobody needed is worse than no note.

Answer with JSON and nothing else:
{"entries": [{"title": "short noun phrase", "body": "the fact itself, in the user's own language, 1-4 sentences"}]}

Write each body in the language the user was writing in.
"""


def _vault_root() -> Optional[str]:
    from plugins.vault.tools import _vault_root as resolve
    root = resolve()
    return str(root) if root else None


def _text_of(message: Dict[str, Any]) -> str:
    """The readable text of a message, whatever shape the provider used."""
    content = message.get("content")

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []

        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])

        return "\n".join(parts)

    return ""


def _digest(messages: List[Dict[str, Any]]) -> str:
    """The tail of the conversation, bounded on every axis that can run away."""
    lines: List[str] = []
    total = 0

    for message in reversed(messages[-MAX_DIGEST_MESSAGES:]):
        role = str(message.get("role") or "")

        if role not in ("user", "assistant"):
            continue

        text = _text_of(message).strip()

        if not text:
            continue

        if len(text) > MAX_MESSAGE_CHARS:
            text = text[:MAX_MESSAGE_CHARS] + " […]"

        entry = f"{role}: {text}"
        total += len(entry) + (2 if lines else 0)

        if total > MAX_DIGEST_CHARS:
            break

        lines.append(entry)

    return "\n\n".join(reversed(lines))


def _worth_reviewing(messages: List[Dict[str, Any]]) -> bool:
    users = [_text_of(m).strip() for m in messages if str(m.get("role")) == "user"]
    users = [text for text in users if text]

    if len(users) < MIN_USER_MESSAGES:
        return False

    return sum(len(text) for text in users) >= MIN_USER_CHARS


def _parse_entries(reply: str) -> List[Dict[str, str]]:
    """The model's answer, taken at arm's length.

    Models fence JSON, prepend a sentence, or answer in prose. None of that is
    worth failing a silent background pass over, but neither is any of it worth
    writing into someone's notes — so anything that does not parse into the
    expected shape files nothing.
    """
    text = (reply or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", text, re.DOTALL)

    if fenced:
        text = fenced.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end <= start:
        return []

    try:
        parsed = json.loads(text[start : end + 1])
    except (TypeError, ValueError):
        return []

    raw = parsed.get("entries") if isinstance(parsed, dict) else None

    if not isinstance(raw, list):
        return []

    entries = []

    for item in raw[:MAX_ENTRIES]:
        if not isinstance(item, dict):
            continue

        title = " ".join(str(item.get("title") or "").split())
        body = str(item.get("body") or "").strip()

        if not body:
            continue

        entries.append({"title": title[:120] or "Note", "body": body[:MAX_ENTRY_CHARS]})

    return entries


def _append_to_inbox(entries: List[Dict[str, str]], *, now: datetime, root: Optional[str] = None) -> Optional[str]:
    """Append to today's Inbox note through the vault's own write path.

    vault_write is used rather than open(): it holds the path-escape guard, the
    atomic temp+rename, and the backup of whatever was there before. A feature
    that files notes must not be the one that loses them.
    """
    from plugins.vault.tools import _resolve, vault_write

    rel = f"{INBOX_DIR}/{now.strftime('%Y-%m-%d')}.md"
    chosen = root or _vault_root()
    if not chosen:
        return None
    vault_root = Path(chosen)
    target = _resolve(vault_root, rel)
    if target is None:
        return None
    stamp = now.strftime("%H:%M")
    blocks = [f"\n## {stamp} — {entry['title']}\n\n{entry['body']}\n" for entry in entries]
    # Internal mutation reads the complete file, never the model-facing preview.
    # Serialise session-end and memory-write callbacks in this backend.
    with _inbox_lock:
        try:
            before = target.read_text(encoding="utf-8") if target.exists() else ""
        except OSError:
            logger.warning("vault filing could not read %s", rel, exc_info=True)
            return None
        existing = before or f"---\ntype: inbox\ndate: {now.strftime('%Y-%m-%d')}\n---\n\n# {now.strftime('%Y-%m-%d')}\n"
        result = vault_write(rel, existing.rstrip() + "\n" + "".join(blocks), root=vault_root, expected_content=before)

    if not result.startswith("Wrote "):
        logger.warning("vault filing could not write %s: %s", rel, result)

        return None

    return rel


class VaultMemoryProvider(MemoryProvider):
    """Files a conversation's durable content into the vault when it ends."""

    @property
    def name(self) -> str:
        return "vault"

    def is_available(self) -> bool:
        # No network check and no imports that could fail — this runs during
        # agent init, on every start.
        return _vault_root() is not None

    def initialize(self, session_id: str, **kwargs) -> None:
        self._session_id = session_id
        self._vault = _vault_root()

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        # Deliberately none. plugins/vault already gives the model vault_read,
        # vault_write and vault_search; a second set under a different name
        # would be exactly the tool-schema bloat the one-provider rule exists
        # to prevent, and would give the model two ways to do one thing.
        return []

    # -- the point of this provider -------------------------------------------

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        try:
            self._file_session(messages)
        except Exception:  # noqa: BLE001 — a background pass must never surface
            logger.debug("vault filing failed", exc_info=True)

    def _file_session(self, messages: List[Dict[str, Any]]) -> None:
        root = getattr(self, "_vault", None) or _vault_root()
        if not root or not _worth_reviewing(messages):
            return

        digest = _digest(messages)

        if not digest:
            return

        from agent.auxiliary_client import get_text_auxiliary_client

        client, model = get_text_auxiliary_client("background_review")

        if client is None or not model:
            logger.debug("vault filing: no auxiliary model available")

            return

        reply = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _FILING_PROMPT},
                {"role": "user", "content": digest},
            ],
        )
        entries = _parse_entries(reply.choices[0].message.content or "")

        if not entries:
            return

        written = _append_to_inbox(entries, now=datetime.now(), root=root)

        if written:
            logger.info("vault filing: wrote %d entr(ies) to %s", len(entries), written)

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror the built-in memory into something the user can actually see.

        hermes' built-in store is ~/.daat/memories/MEMORY.md — real, and
        invisible to someone told their notes are files they own. Without this
        the product has two memories that do not know about each other, and the
        one holding "what the agent knows about you" is the one you cannot
        open, edit, or disagree with.
        """
        try:
            if action not in ("add", "replace") or not content.strip() or not _vault_root():
                return

            _append_to_inbox(
                [{"title": f"Remembered ({target})", "body": content.strip()[:MAX_ENTRY_CHARS]}],
                now=datetime.now(),
                root=getattr(self, "_vault", None),
            )
        except Exception:  # noqa: BLE001
            logger.debug("vault memory mirror failed", exc_info=True)


def register(ctx) -> None:
    ctx.register_memory_provider(VaultMemoryProvider())
