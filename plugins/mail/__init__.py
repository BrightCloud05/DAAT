"""Daat mail plugin — email through the Himalaya CLI.

Read/search/organize run directly; `mail_send` always goes through the human
approval gate (never sends unattended). Credentials stay in Himalaya's own
config; Daat never sees a password.
"""

from __future__ import annotations

from . import tools


def register(ctx):
    ctx.register_tool(
        name="mail_accounts",
        toolset="mail",
        schema={
            "name": "mail_accounts",
            "description": "List the user's connected email accounts (name, backend, which is default).",
            "parameters": {"type": "object", "properties": {}},
        },
        handler=lambda args, **kw: tools.mail_accounts(),
        description="List email accounts",
        emoji="📮",
    )

    ctx.register_tool(
        name="mail_folders",
        toolset="mail",
        schema={
            "name": "mail_folders",
            "description": "List mail folders for an account (INBOX, Sent, Drafts, and any custom folders).",
            "parameters": {
                "type": "object",
                "properties": {"account": {"type": "string", "description": "Account name; default account if omitted"}},
            },
        },
        handler=lambda args, **kw: tools.mail_folders(args.get("account")),
        description="List mail folders",
        emoji="🗄️",
    )

    ctx.register_tool(
        name="mail_list",
        toolset="mail",
        schema={
            "name": "mail_list",
            "description": "List recent messages in a folder (newest first) with id, date, sender, subject, unread mark.",
            "parameters": {
                "type": "object",
                "properties": {
                    "folder": {"type": "string", "description": "Folder name, default INBOX"},
                    "limit": {"type": "integer", "description": "How many messages (default 25, max 100)"},
                    "account": {"type": "string"},
                },
            },
        },
        handler=lambda args, **kw: tools.mail_list(
            args.get("folder", "INBOX"), args.get("limit", 25), args.get("account")
        ),
        description="List messages",
        emoji="📬",
    )

    ctx.register_tool(
        name="mail_read",
        toolset="mail",
        schema={
            "name": "mail_read",
            "description": "Read one message by id (from mail_list). Preview mode by default — does not mark it read.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {"type": "string", "description": "Envelope id from mail_list"},
                    "folder": {"type": "string", "description": "Folder the message is in, default INBOX"},
                    "mark_seen": {"type": "boolean", "description": "Mark the message as read (default false)"},
                    "account": {"type": "string"},
                },
                "required": ["message_id"],
            },
        },
        handler=lambda args, **kw: tools.mail_read(
            args.get("message_id", ""),
            args.get("folder", "INBOX"),
            args.get("account"),
            bool(args.get("mark_seen")),
        ),
        description="Read a message",
        emoji="📖",
    )

    ctx.register_tool(
        name="mail_search",
        toolset="mail",
        schema={
            "name": "mail_search",
            "description": (
                "Search messages. Conditions: from/to/subject/body <pattern>, date/before/after "
                "<yyyy-mm-dd>, flag <flag>; combine with and/or/not, e.g. "
                "'from dana and after 2026-07-01', 'not flag seen', 'subject invoice'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "folder": {"type": "string", "description": "Default INBOX"},
                    "limit": {"type": "integer"},
                    "account": {"type": "string"},
                },
                "required": ["query"],
            },
        },
        handler=lambda args, **kw: tools.mail_search(
            args.get("query", ""), args.get("folder", "INBOX"), args.get("limit", 25), args.get("account")
        ),
        description="Search mail",
        emoji="🔎",
    )

    ctx.register_tool(
        name="mail_move",
        toolset="mail",
        schema={
            "name": "mail_move",
            "description": "Move a message to another folder (used for inbox triage / filing).",
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {"type": "string"},
                    "target_folder": {"type": "string"},
                    "folder": {"type": "string", "description": "Source folder, default INBOX"},
                    "account": {"type": "string"},
                },
                "required": ["message_id", "target_folder"],
            },
        },
        handler=lambda args, **kw: tools.mail_move(
            args.get("message_id", ""), args.get("target_folder", ""), args.get("folder", "INBOX"), args.get("account")
        ),
        description="File a message",
        emoji="📂",
    )

    ctx.register_tool(
        name="mail_flag",
        toolset="mail",
        schema={
            "name": "mail_flag",
            "description": "Add or remove a flag on a message: Seen, Flagged, Answered, Draft, Deleted.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {"type": "string"},
                    "flag": {"type": "string"},
                    "remove": {"type": "boolean", "description": "Remove instead of add"},
                    "folder": {"type": "string"},
                    "account": {"type": "string"},
                },
                "required": ["message_id", "flag"],
            },
        },
        handler=lambda args, **kw: tools.mail_flag(
            args.get("message_id", ""),
            args.get("flag", ""),
            bool(args.get("remove")),
            args.get("folder", "INBOX"),
            args.get("account"),
        ),
        description="Flag a message",
        emoji="🚩",
    )

    ctx.register_tool(
        name="mail_draft",
        toolset="mail",
        schema={
            "name": "mail_draft",
            "description": (
                "Save an email to Drafts for the user to review. PREFER THIS over mail_send unless the "
                "user explicitly asked you to send."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient address(es), comma separated"},
                    "subject": {"type": "string"},
                    "body": {"type": "string", "description": "Plain-text body"},
                    "cc": {"type": "string"},
                    "bcc": {"type": "string"},
                    "account": {"type": "string"},
                },
                "required": ["to", "subject", "body"],
            },
        },
        handler=lambda args, **kw: tools.mail_draft(
            args.get("to", ""),
            args.get("subject", ""),
            args.get("body", ""),
            args.get("cc", ""),
            args.get("bcc", ""),
            args.get("account"),
        ),
        description="Save a draft",
        emoji="📝",
    )

    ctx.register_tool(
        name="mail_send",
        toolset="mail",
        schema={
            "name": "mail_send",
            "description": (
                "Send an email as the user. Requires human approval every time — the user sees the "
                "recipients, subject and body before it goes out."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient address(es), comma separated"},
                    "subject": {"type": "string"},
                    "body": {"type": "string", "description": "Plain-text body"},
                    "cc": {"type": "string"},
                    "bcc": {"type": "string"},
                    "account": {"type": "string"},
                },
                "required": ["to", "subject", "body"],
            },
        },
        handler=lambda args, **kw: tools.mail_send(
            args.get("to", ""),
            args.get("subject", ""),
            args.get("body", ""),
            args.get("cc", ""),
            args.get("bcc", ""),
            args.get("account"),
            approval_callback=kw.get("approval_callback"),
        ),
        description="Send an email (approval required)",
        emoji="📤",
    )
