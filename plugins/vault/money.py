"""Money tools: the agent's side of the statement-to-transactions flow.

The model reads a bank statement (image or PDF the user dropped into the
chat) and calls `money_add_transactions` with structured rows. We append
them to the month note as a markdown table — plain files the user owns —
skipping duplicates so re-importing the same statement is safe.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .tools import _resolve, _vault_root, vault_write

HEADER = "| Date | Description | Category | Amount |"
DIVIDER = "| --- | --- | --- | --- |"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _month_path(date: str) -> str:
    return f"Money/{date[:7]}.md"


def _empty_note(month: str) -> str:
    return f"---\ntype: money\nmonth: {month}\n---\n\n# {month}\n\n{HEADER}\n{DIVIDER}\n"


def _existing_keys(content: str) -> set[str]:
    keys = set()

    for line in content.splitlines():
        stripped = line.strip()

        if not stripped.startswith("|") or stripped.startswith("| ---"):
            continue

        cells = [cell.strip() for cell in stripped.split("|")[1:-1]]

        if len(cells) < 4 or not DATE_RE.match(cells[0]):
            continue

        try:
            amount = float(cells[3].replace("$", "").replace(",", ""))
        except ValueError:
            continue

        keys.add(f"{cells[0]}|{amount:.2f}|{cells[1].lower()}")

    return keys


def money_add_transactions(rows_json: str, source: str = "") -> str:
    """Append extracted transactions to their month notes.

    rows_json: JSON array of {date: YYYY-MM-DD, description, category, amount}
    where amount is a signed number (negative = money out).
    """
    root = _vault_root()

    if not root:
        return "No vault is connected — ask the user to open a vault in BISEO first."

    try:
        rows = json.loads(rows_json) if isinstance(rows_json, str) else rows_json
    except (TypeError, ValueError):
        return "rows must be a JSON array of {date, description, category, amount}."

    if not isinstance(rows, list) or not rows:
        return "No transactions were provided."

    by_month: dict[str, list[dict]] = {}
    rejected = 0

    for row in rows:
        if not isinstance(row, dict):
            rejected += 1
            continue

        date = str(row.get("date", "")).strip()
        description = str(row.get("description", "")).strip()

        try:
            amount = float(str(row.get("amount", "")).replace("$", "").replace(",", ""))
        except (TypeError, ValueError):
            rejected += 1
            continue

        if not DATE_RE.match(date) or not description:
            rejected += 1
            continue

        by_month.setdefault(_month_path(date), []).append(
            {
                "date": date,
                "description": description.replace("|", "/"),
                "category": (str(row.get("category", "")).strip() or "Uncategorized").replace("|", "/"),
                "amount": amount,
            }
        )

    if not by_month:
        return f"None of the {len(rows)} rows were usable (need date YYYY-MM-DD, description, numeric amount)."

    added_total = 0
    skipped_total = 0
    touched = []

    for rel_path, month_rows in by_month.items():
        absolute = _resolve(root, rel_path)

        if not absolute:
            continue

        month = Path(rel_path).stem
        content = absolute.read_text(encoding="utf-8") if absolute.exists() else _empty_note(month)

        if HEADER not in content:
            content = content.rstrip() + f"\n\n{HEADER}\n{DIVIDER}\n"

        keys = _existing_keys(content)
        lines = []

        for row in sorted(month_rows, key=lambda item: item["date"]):
            key = f'{row["date"]}|{row["amount"]:.2f}|{row["description"].lower()}'

            if key in keys:
                skipped_total += 1
                continue

            keys.add(key)
            added_total += 1
            lines.append(
                f'| {row["date"]} | {row["description"]} | {row["category"]} | {row["amount"]:.2f} |'
            )

        if lines:
            content = content.rstrip() + "\n" + "\n".join(lines) + "\n"

            if source:
                marker = f"\n<!-- imported from: {source} -->\n"

                if marker.strip() not in content:
                    content = content.rstrip() + "\n" + marker

            vault_write(rel_path, content)
            touched.append(rel_path)

    summary = [f"Added {added_total} transaction(s)"]

    if skipped_total:
        summary.append(f"skipped {skipped_total} duplicate(s)")

    if rejected:
        summary.append(f"ignored {rejected} unusable row(s)")

    summary.append(f'in {", ".join(touched) if touched else "no files"}')

    return " · ".join(summary) + ". The user can review the table in the Money screen."


def money_summary(month: str = "") -> str:
    """Totals for a month (YYYY-MM); defaults to the latest month note."""
    root = _vault_root()

    if not root:
        return "No vault is connected."

    money_dir = root / "Money"

    if not money_dir.is_dir():
        return "No money notes yet. Drop a bank statement into the chat and I'll extract the transactions."

    if month.strip():
        target = money_dir / f"{month.strip()}.md"
    else:
        notes = sorted(money_dir.glob("*.md"))
        target = notes[-1] if notes else None

    if not target or not target.exists():
        return f"No note for {month or 'that month'}."

    content = target.read_text(encoding="utf-8")
    income = 0.0
    spend = 0.0
    categories: dict[str, float] = {}
    count = 0

    for line in content.splitlines():
        stripped = line.strip()

        if not stripped.startswith("|") or stripped.startswith("| ---") or stripped.lower().startswith("| date"):
            continue

        cells = [cell.strip() for cell in stripped.split("|")[1:-1]]

        if len(cells) < 4 or not DATE_RE.match(cells[0]):
            continue

        try:
            amount = float(cells[3].replace("$", "").replace(",", ""))
        except ValueError:
            continue

        count += 1

        if amount >= 0:
            income += amount
        else:
            spend += abs(amount)

        categories[cells[2] or "Uncategorized"] = categories.get(cells[2] or "Uncategorized", 0.0) + amount

    lines = [
        f"{target.stem}: {count} transaction(s)",
        f"  in  +{income:,.2f}",
        f"  out -{spend:,.2f}",
        f"  net {income - spend:+,.2f}",
        "  by category:",
    ]

    for category, total in sorted(categories.items(), key=lambda item: item[1]):
        lines.append(f"    {category}: {total:+,.2f}")

    return "\n".join(lines)
