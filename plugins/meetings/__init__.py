"""BISEO meetings plugin.

Turns a recording the user made in BISEO into text the agent can work with.
Transcription uses hermes's existing STT stack, whose default provider is
faster-whisper running locally — so a meeting recording, which contains other
people's voices, is not uploaded anywhere by default.
"""

from __future__ import annotations

from . import tools


def register(ctx):
    ctx.register_tool(
        name="meeting_transcribe",
        toolset="meetings",
        schema={
            "name": "meeting_transcribe",
            "description": (
                "Transcribe an audio recording stored in the user's vault. Returns the transcript text. "
                "Use it before summarising a meeting, then write the summary into the meeting note with "
                "vault_write. Long recordings take a while — say so before starting."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Vault-relative path to the recording, e.g. 'Meetings/2026-07-29 Standup/audio.webm'",
                    },
                    "language": {
                        "type": "string",
                        "description": "Optional ISO code ('en', 'ko') to skip auto-detection",
                    },
                },
                "required": ["path"],
            },
        },
        handler=lambda args, **kw: tools.meeting_transcribe(args.get("path", ""), args.get("language", "")),
        description="Transcribe a meeting recording",
        emoji="🎙️",
    )

    ctx.register_tool(
        name="meeting_list_recordings",
        toolset="meetings",
        schema={
            "name": "meeting_list_recordings",
            "description": "List audio recordings in the vault's Meetings folder.",
            "parameters": {"type": "object", "properties": {}},
        },
        handler=lambda args, **kw: tools.meeting_list_recordings(),
        description="List meeting recordings",
        emoji="📼",
    )
