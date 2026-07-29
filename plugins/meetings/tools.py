"""Meeting tools: turn a recording in the vault into a transcript.

Transcription runs through hermes's existing STT stack, which defaults to
faster-whisper running locally — no API key, no per-minute cost, and the
audio never leaves the machine. That matters more than usual here: meeting
recordings contain other people's voices, and those people did not choose
this app.

The summary is deliberately NOT done here. The agent reads the transcript and
writes the note with vault_write, so the user sees the same tool calls (and
the same approval surface) as any other edit.
"""

from __future__ import annotations

import os
import unicodedata
from pathlib import Path

MAX_TRANSCRIPT_CHARS = 100_000
AUDIO_SUFFIXES = {".webm", ".m4a", ".mp3", ".wav", ".ogg", ".mp4", ".mpga", ".aac", ".flac"}


def _vault_root() -> Path | None:
    """Same resolution the vault tools use: bridge file first, env second."""
    from plugins.vault.tools import _vault_root as resolve

    return resolve()


def meeting_transcribe(rel_path: str, language: str = "") -> str:
    """Transcribe an audio file stored in the vault.

    rel_path: vault-relative path to the recording, e.g.
    "Meetings/2026-07-29 Standup/audio.webm".
    """
    root = _vault_root()

    if not root:
        return "No vault is connected. Ask the user to open a vault in BISEO first."

    cleaned = str(rel_path).replace("\\", "/").lstrip("/")
    target = (root / cleaned).resolve()

    if target != root.resolve() and root.resolve() not in target.parents:
        return f"Refused: '{rel_path}' escapes the vault."

    if target.suffix.lower() not in AUDIO_SUFFIXES:
        return f"Not an audio file: {rel_path} (expected one of {', '.join(sorted(AUDIO_SUFFIXES))})."

    if not target.exists():
        return f"Not found: {rel_path}"

    size_mb = target.stat().st_size / 1_048_576

    try:
        from tools.transcription_tools import transcribe_audio
    except ImportError as error:
        return f"Transcription is unavailable in this install: {error}"

    try:
        result = transcribe_audio(str(target), **({"language": language} if language.strip() else {}))
    except TypeError:
        # Older signature without a language argument.
        result = transcribe_audio(str(target))
    except Exception as error:  # noqa: BLE001 — surface the reason to the model
        return f"Could not transcribe {rel_path}: {error}"

    if not isinstance(result, dict) or not result.get("success"):
        reason = (result or {}).get("error") if isinstance(result, dict) else "unknown error"

        return (
            f"Transcription failed for {rel_path}: {reason}. "
            "The local Whisper model installs and downloads on first use (~150 MB), which needs a network "
            "connection once; after that transcription is offline."
        )

    transcript = unicodedata.normalize("NFC", str(result.get("transcript") or "").strip())

    if not transcript:
        return f"{rel_path} transcribed to nothing — the recording may be silent."

    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        transcript = transcript[:MAX_TRANSCRIPT_CHARS] + f"\n\n[... truncated, {len(transcript)} chars total]"

    header = f"Transcript of {rel_path} ({size_mb:.1f} MB"
    provider = result.get("provider")

    if provider:
        header += f", via {provider}"

    return f"{header}):\n\n{transcript}"


def meeting_list_recordings() -> str:
    """Recordings in the vault that have no transcript in their note yet."""
    root = _vault_root()

    if not root:
        return "No vault is connected."

    folder = root / "Meetings"

    if not folder.is_dir():
        return "No Meetings folder yet — record one in BISEO first."

    found: list[str] = []

    for current, dirs, files in os.walk(folder):
        dirs[:] = [name for name in dirs if not name.startswith(".")]

        for name in sorted(files):
            if Path(name).suffix.lower() in AUDIO_SUFFIXES:
                found.append(str((Path(current) / name).relative_to(root)))

    return "\n".join(sorted(found)) if found else "No recordings found."
