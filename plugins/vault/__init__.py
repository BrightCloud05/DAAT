"""Daat vault plugin.

Gives the agent first-class tools over the user's markdown vault (the folder
Daat Desktop manages) and injects the currently-open note as ephemeral
context each turn (bridge file written by the desktop, mirroring the proven
obsidian-context-bridge pattern).

Environment (injected by Daat Desktop when it spawns the backend):
  VAULT_PATH      absolute path of the open vault root
  VAULT_INDEX_DB  optional path of the desktop's SQLite link/FTS index
"""

from __future__ import annotations

from . import context_bridge, money, tools


def register(ctx):
    ctx.register_hook("pre_llm_call", context_bridge.pre_llm_call)

    ctx.register_tool(
        name="vault_read",
        toolset="vault",
        schema={
            "name": "vault_read",
            "description": (
                "Read a note from the user's vault. Path is vault-relative, e.g. 'Projects/Plan.md'. "
                "Returns the markdown content."
            ),
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Vault-relative note path"}},
                "required": ["path"],
            },
        },
        handler=lambda args, **kw: tools.vault_read(args.get("path", "")),
        description="Read a vault note",
        emoji="📖",
    )

    ctx.register_tool(
        name="vault_write",
        toolset="vault",
        schema={
            "name": "vault_write",
            "description": (
                "Write a note in the user's vault (creates parent folders; atomic write). "
                "Prefer minimal edits: read first, modify, write back. Never write outside the vault."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Vault-relative note path, .md appended if missing"},
                    "content": {"type": "string", "description": "Full markdown content to write"},
                },
                "required": ["path", "content"],
            },
        },
        handler=lambda args, **kw: tools.vault_write(args.get("path", ""), args.get("content", "")),
        description="Write a vault note",
        emoji="✏️",
    )

    ctx.register_tool(
        name="vault_list",
        toolset="vault",
        schema={
            "name": "vault_list",
            "description": "List notes in the vault (optionally under a subfolder). Returns vault-relative paths.",
            "parameters": {
                "type": "object",
                "properties": {"subdir": {"type": "string", "description": "Optional subfolder to list"}},
            },
        },
        handler=lambda args, **kw: tools.vault_list(args.get("subdir", "")),
        description="List vault notes",
        emoji="🗂️",
    )

    ctx.register_tool(
        name="vault_search",
        toolset="vault",
        schema={
            "name": "vault_search",
            "description": "Full-text search across the vault. Returns matching lines with note paths.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search text"}},
                "required": ["query"],
            },
        },
        handler=lambda args, **kw: tools.vault_search(args.get("query", "")),
        description="Search the vault",
        emoji="🔎",
    )

    ctx.register_tool(
        name="money_add_transactions",
        toolset="vault",
        schema={
            "name": "money_add_transactions",
            "description": (
                "Record transactions extracted from a bank statement (image, PDF or pasted text) into "
                "the user's vault. Pass rows as a JSON array of "
                '{"date": "YYYY-MM-DD", "description": str, "category": str, "amount": number} where '
                "amount is negative for money out. Duplicates are skipped, so re-importing is safe. "
                "Always show the user what you extracted before/after recording."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "rows": {"type": "string", "description": "JSON array of transaction objects"},
                    "source": {"type": "string", "description": "Optional statement name for provenance"},
                },
                "required": ["rows"],
            },
        },
        handler=lambda args, **kw: money.money_add_transactions(args.get("rows", ""), args.get("source", "")),
        description="Record transactions",
        emoji="💰",
    )

    ctx.register_tool(
        name="money_summary",
        toolset="vault",
        schema={
            "name": "money_summary",
            "description": "Totals and category breakdown for a month of transactions (YYYY-MM; latest if omitted).",
            "parameters": {
                "type": "object",
                "properties": {"month": {"type": "string", "description": "YYYY-MM"}},
            },
        },
        handler=lambda args, **kw: money.money_summary(args.get("month", "")),
        description="Money summary",
        emoji="📊",
    )

    ctx.register_tool(
        name="vault_backlinks",
        toolset="vault",
        schema={
            "name": "vault_backlinks",
            "description": "Notes that link to the given note via [[wikilinks]].",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Vault-relative note path"}},
                "required": ["path"],
            },
        },
        handler=lambda args, **kw: tools.vault_backlinks(args.get("path", "")),
        description="Find backlinks to a note",
        emoji="🔗",
    )
