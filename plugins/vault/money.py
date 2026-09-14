"""Money tools: the agent's side of the statement-to-transactions flow.

The model reads a bank statement (image or PDF the user dropped into the
chat) and calls `money_add_transactions` with structured rows. We append
them to the month note as a markdown table — plain files the user owns —
skipping duplicates so re-importing the same statement is safe.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from .tools import _resolve, _vault_root, vault_write

HEADER = "| Date | Description | Category | Amount |"
DIVIDER = "| --- | --- | --- | --- |"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"\d{4}-\d{2}")


def _month_path(date: str) -> str:
    return f"Money/{date[:7]}.md"


def _empty_note(month: str) -> str:
    return f"---\ntype: money\nmonth: {month}\n---\n\n# {month}\n\n{HEADER}\n{DIVIDER}\n"


def _existing_counts(content: str) -> Counter[str]:
    """How many times each transaction already appears in the note.

    Counted, not a set. Two $4.50 coffees at the same cafe on the same day are
    one key and two transactions; presence-only matching dropped the second and
    reported it as a duplicate, so the month's spend was quietly short and the
    user had nothing to reconcile against. The desktop's port of this function
    already counts (app/notes/money.ts) — this is the writer that actually runs.
    """
    counts: Counter[str] = Counter()

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

        counts[f"{cells[0]}|{amount:.2f}|{cells[1].lower()}"] += 1

    return counts


def money_add_transactions(rows_json: str, source: str = "") -> str:
    """Append extracted transactions to their month notes.

    rows_json: JSON array of {date: YYYY-MM-DD, description, category, amount}
    where amount is a signed number (negative = money out).
    """
    root = _vault_root()

    if not root:
        return "No vault is connected — ask the user to open a vault in Daat first."

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
        description = " ".join(str(row.get("description", "")).split())

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
                "category": (" ".join(str(row.get("category", "")).split()) or "Uncategorized").replace(
                    "|", "/"
                ),
                "amount": amount,
            }
        )

    if not by_month:
        return f"None of the {len(rows)} rows were usable (need date YYYY-MM-DD, description, numeric amount)."

    added_total = 0
    skipped_total = 0
    touched = []
    failed = []

    for rel_path, month_rows in by_month.items():
        absolute = _resolve(root, rel_path)

        if not absolute:
            failed.append(f"{rel_path} (path escapes the vault)")
            continue

        month = Path(rel_path).stem

        try:
            content = absolute.read_text(encoding="utf-8") if absolute.exists() else _empty_note(month)
        except OSError as error:
            # An iCloud-evicted month note, or a volume that went away. Writing
            # over it would replace a month of transactions with this import.
            failed.append(f"{rel_path} ({error})")
            continue

        if HEADER not in content:
            content = content.rstrip() + f"\n\n{HEADER}\n{DIVIDER}\n"

        existing = _existing_counts(content)
        seen: Counter[str] = Counter()
        month_added = 0
        month_skipped = 0
        lines = []

        for row in sorted(month_rows, key=lambda item: item["date"]):
            key = f'{row["date"]}|{row["amount"]:.2f}|{row["description"].lower()}'
            seen[key] += 1

            # Skip only as many copies as the note already holds. Re-importing
            # the same statement still adds nothing; a genuine second identical
            # purchase still lands.
            if seen[key] <= existing[key]:
                month_skipped += 1
                continue

            month_added += 1
            lines.append(
                f'| {row["date"]} | {row["description"]} | {row["category"]} | {row["amount"]:.2f} |'
            )

        if not lines:
            skipped_total += month_skipped
            continue

        # Provenance goes ABOVE the table. Appended below it, the next import's
        # rows land under the comment, where the blank line has already ended
        # the table — so they render as literal pipes instead of cells.
        if source:
            marker = f"<!-- imported from: {source} -->"

            if marker not in content:
                content = content.replace(HEADER, f"{marker}\n\n{HEADER}", 1)

        content = content.rstrip() + "\n" + "\n".join(lines) + "\n"

        # vault_write reports failure by RETURNING a string, not by raising. The
        # bare call here meant a write refused for a closed vault or a read-only
        # volume was reported to the user as a completed import, and the
        # statement they then filed away was the only copy.
        # Caught, so one unwritable month does not abandon the others: an
        # exception here used to escape with earlier months already on disk and
        # later ones never attempted, and no summary of either.
        try:
            result = vault_write(rel_path, content)
        except Exception as error:  # noqa: BLE001 — report it, don't lose the rest
            result = f"Could not write {rel_path}: {error}"

        if not result.startswith("Wrote "):
            failed.append(f"{rel_path} ({result})")
            continue

        added_total += month_added
        skipped_total += month_skipped
        touched.append(rel_path)

    summary = [f"Added {added_total} transaction(s)"]

    if skipped_total:
        summary.append(f"skipped {skipped_total} duplicate(s)")

    if rejected:
        summary.append(f"ignored {rejected} unusable row(s)")

    summary.append(f'in {", ".join(touched) if touched else "no files"}')

    if failed:
        return (
            " · ".join(summary)
            + ". WRITE FAILED for "
            + "; ".join(failed)
            + " — those transactions were NOT saved. Tell the user, and do not say the statement is recorded."
        )

    return " · ".join(summary) + ". The user can review the table in the Money screen."


def money_summary(month: str = "") -> str:
    """Totals for a month (YYYY-MM); defaults to the latest month note."""
    root = _vault_root()

    if not root:
        return "No vault is connected."

    money_dir = root / "Money"

    if not money_dir.is_dir():
        return "No money notes yet. Drop a bank statement into the chat and I'll extract the transactions."

    wanted = month.strip()

    if wanted and not MONTH_RE.fullmatch(wanted):
        # Interpolated straight into a path below, and the model supplies it.
        return "Month must be YYYY-MM."

    if wanted:
        target = money_dir / f"{wanted}.md"
    else:
        # Month notes only. An unfiltered glob sorts letters after digits, so a
        # hand-written Money/Budget.md became "the latest month" and its planned
        # figures were reported as actual spend.
        notes = sorted(path for path in money_dir.glob("*.md") if MONTH_RE.fullmatch(path.stem))
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
