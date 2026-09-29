"""Current-note context bridge.

Daat Desktop writes <HERMES_HOME>/state/vault-context.json whenever the
active note or selection changes; this hook injects a compact block into the
next turn so the agent always knows what the user is looking at. Stale
payloads (older than the freshness window) are ignored — an idle desktop
must not haunt tomorrow's conversations.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

FRESH_MS = 5 * 60 * 1000
MAX_SELECTION_CHARS = 3_000


def _bridge_path() -> Path:
    home = os.environ.get("HERMES_HOME", "").strip() or str(Path.home() / ".daat")

    return Path(home) / "state" / "vault-context.json"


STOPWORDS = {
    "about", "after", "again", "against", "because", "been", "before", "being", "between", "both",
    "could", "does", "doing", "down", "during", "each", "from", "further", "have", "having", "here",
    "into", "just", "more", "most", "only", "other", "over", "same", "should", "some", "such",
    "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "through",
    "under", "until", "very", "were", "what", "when", "where", "which", "while", "with", "would",
    "your", "please", "make", "made", "give", "tell", "show", "help", "want", "need", "know",
    # Korean question words and verb stems. They survive particle-stripping and
    # would otherwise eat the four query slots that the content nouns need.
    "그리고", "그런데", "하지만", "에서", "으로", "에게", "정리", "알려", "해줘", "하는", "있는", "관련",
    "어떻게", "어디", "언제", "누가", "무엇", "뭐라고", "얼마", "정했", "정했지", "했더라", "했었",
    "그거", "저거", "이거", "지금", "다시", "우리", "내가", "너가", "관련해", "대해서", "대해",
}

# Enough to be useful, small enough that it cannot dominate a turn's prompt.
MAX_RECALL_NOTES = 5
MAX_RECALL_SNIPPET = 220
MAX_QUERY_TERMS = 4
MIN_MESSAGE_CHARS = 8

# Short on purpose: it is prepended to every single turn, so it is paying rent
# in the prompt forever. Stable wording, so prompt caching keeps hitting.
STANDING_INSTRUCTION = (
    "[Daat] The user's vault is their second brain — a folder of markdown notes that is the "
    "durable record of their work and their life. Two habits, both unprompted: search it with "
    "vault_search and read hits with vault_read before answering anything about their own "
    "material, rather than answering from nothing; and write what is worth having next month "
    "back into it with vault_write — a decision and why, a fact about them, a plan, a deadline. "
    "The vault may be empty today. That is when starting matters most."
)

# Hangul, kana and CJK ideographs at two characters; Latin at three. The floor
# differs because the information density does: 정책 is a whole noun, "th" is not.
CJK_TOKEN = re.compile(r"[가-힣ぁ-んァ-ヶ一-龥]{2,}")
LATIN_TOKEN = re.compile(r"[a-z0-9_]{3,}")
CJK_ONLY = re.compile(r"[가-힣ぁ-んァ-ヶ一-龥]+")
# Longest first, so 에서 is tried before 에.
KOREAN_SUFFIXES = (
    "했더라",
    "관련해서",
    "해줘",
    "해서",
    "했지",
    "했어",
    "하지",
    "에서",
    "에게",
    "으로",
    "이라",
    "라고",
    "한테",
    "까지",
    "부터",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "에",
    "와",
    "과",
    "의",
    "도",
    "만",
    "로",
)


def _strip_particles(token: str) -> str:
    """A Korean noun without the grammar stuck to the end of it.

    Korean glues particles and endings onto words, and vault_search is a
    literal substring match (`rg -F`). So a note saying "가격 정책은" is not
    found by searching "정책은" — and the user never typed the bare noun,
    because nobody does.
    """
    for suffix in KOREAN_SUFFIXES:
        if len(token) > len(suffix) + 1 and token.endswith(suffix):
            return token[: -len(suffix)]

    return token


def _terms(message: str) -> list[str]:
    """The words worth searching the vault for, most specific first.

    A whole sentence is a terrible search: vault_search matches literal
    phrases, so "what did I decide about the pricing page" finds nothing while
    "pricing" finds the note.

    CJK is tokenized separately, and this is not a refinement — it is the
    difference between the feature working and not. Korean content nouns are
    routinely two syllables (가격, 정책, 회의, 일정), so a flat 3-character
    floor threw away every one of them and kept the grammar words. "가격 정책
    어떻게 정했지?" reduced to ['어떻게', '정했지'], which match nothing, and
    recall came back empty on every Korean turn — silently, which is the whole
    failure mode this module exists to prevent.
    """
    seen: dict[str, None] = {}

    for word in re.findall(CJK_TOKEN, message.lower()):
        bare = _strip_particles(word)

        if bare not in STOPWORDS and len(bare) >= 2:
            seen.setdefault(bare, None)

    for word in re.findall(LATIN_TOKEN, message.lower()):
        if word not in STOPWORDS and not word.isdigit():
            seen.setdefault(word, None)

    # Longest-first is a specificity proxy for Latin, where a long word is a
    # rare one. It is backwards for Korean, where the extra characters are the
    # particles we just removed — so CJK keeps the order it was written in.
    latin = sorted((word for word in seen if not CJK_ONLY.fullmatch(word)), key=len, reverse=True)
    cjk = [word for word in seen if CJK_ONLY.fullmatch(word)]

    return (cjk + latin)[:MAX_QUERY_TERMS]


def _has_vault() -> bool:
    """Is there a vault to talk about at all?"""
    try:
        from plugins.vault.tools import _vault_root
    except ImportError:
        return False

    return _vault_root() is not None


def _recall(message: str) -> list[str]:
    """Notes in the vault that bear on what the user just said.

    WHY THIS IS AUTOMATIC

    The agent already has vault_search, and the persona already tells it to use
    the vault. That makes recall a decision the model takes, or forgets to take,
    on every turn — and the failure is silent: it answers from nothing and
    sounds just as confident. Searching here makes it a habit instead, so an
    answer is grounded in the user's own notes whether or not the model thought
    to look.
    """
    if len(message.strip()) < MIN_MESSAGE_CHARS:
        return []

    try:
        from plugins.vault.tools import vault_search
    except ImportError:
        return []

    found: dict[str, str] = {}

    for term in _terms(message):
        if len(found) >= MAX_RECALL_NOTES:
            break

        try:
            raw = vault_search(term)
        except Exception:  # noqa: BLE001 — recall must never break a turn
            continue

        if not raw or raw in ("No matches.", "Empty query.") or raw.startswith("No vault"):
            continue

        for line in raw.splitlines():
            # vault_search yields "<relative path>:<line>:<text>".
            path, _, rest = line.partition(":")
            _, _, text = rest.partition(":")
            path = path.strip()
            text = text.strip()

            if not path:
                continue

            # When the search term is also the note's title, the first hit is
            # the heading — which repeats the filename and says nothing. Prefer
            # a line with actual content, and keep the heading only as a
            # fallback so a title-only match still shows the note.
            informative = bool(text) and not text.lstrip().startswith("#")

            if path not in found or (informative and found[path].lstrip().startswith("#")):
                found[path] = text[:MAX_RECALL_SNIPPET]

            if len(found) >= MAX_RECALL_NOTES and all(
                not value.lstrip().startswith("#") for value in found.values()
            ):
                break

    return [f"- {path} — {snippet}" if snippet else f"- {path}" for path, snippet in found.items()]


def pre_llm_call(**kwargs):
    message = str(kwargs.get("user_message") or "")
    recalled = _recall(message)

    try:
        payload = json.loads(_bridge_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    # No note open is normal — most chat happens away from the editor. The tail
    # below builds whatever context there is; recall alone is enough.

    updated = payload.get("updated_at")
    fresh = isinstance(updated, (int, float)) and (time.time() * 1000 - updated) <= FRESH_MS
    note = str(payload.get("active_note") or "").strip() if fresh else ""

    parts: list[str] = []

    if note:
        parts.append(f"[Daat context] The user is currently viewing the vault note: {note}")
        selection = str(payload.get("selection") or "").strip()

        if selection:
            parts.append(f'Selected text: """{selection[:MAX_SELECTION_CHARS]}"""')

    if recalled:
        # Recall survives a stale or missing bridge payload. The open note and
        # the notes that bear on the question are different facts, and dropping
        # the second because the first went stale is how the assistant ends up
        # answering from nothing.
        parts.append("[Daat vault] Notes of the user's that relate to this message:")
        parts.extend(recalled)
        parts.append("Read them with vault_read before answering, and answer from them where they apply.")

    # The standing fact goes in EVERY turn a vault is connected, including the
    # first one on a machine where that vault is still empty.
    #
    # It used to be the opposite: with nothing open and nothing recalled the
    # hook returned None, so on day one the agent was told nothing at all about
    # the vault. It only learned the vault existed once the vault already held
    # something matching — the wrong way round, because day one is exactly when
    # there is nothing in there and the habit of writing has to start.
    #
    # Gated on the vault EXISTING, not on recall finding anything. With no
    # vault connected this says nothing, because instructing the model to call
    # vault_search when there is nothing to search is worse than silence.
    if _has_vault():
        parts.append(STANDING_INSTRUCTION)

    if not parts:
        return None

    return {"context": "\n".join(parts)}
