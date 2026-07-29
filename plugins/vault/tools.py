"""Vault tool implementations: plain filesystem + optional SQLite index.

Every path is vault-relative; resolution refuses anything escaping the vault
root. Writes are atomic (temp + rename) so iCloud sync never sees a half
file — the same contract the desktop's own writer keeps.
"""

from __future__ import annotations

import os
import re
import sqlite3
import subprocess
import tempfile
import unicodedata
from pathlib import Path

MAX_READ_CHARS = 120_000
MAX_LIST = 400
MAX_SEARCH_RESULTS = 40


def _bridge_file() -> Path:
    home = os.environ.get("HERMES_HOME", "").strip() or str(Path.home() / ".biseo")

    return Path(home) / "state" / "vault-context.json"


def _vault_root() -> Path | None:
    """Resolve the open vault.

    VAULT_PATH is set when the desktop spawns the backend — but the backend
    starts before a vault is restored/opened, so an empty env is normal. The
    desktop keeps the live vault root in the context bridge file; read that
    first so tools work in the session the user opened their vault in.
    """
    candidates = []

    try:
        import json

        bridge = json.loads(_bridge_file().read_text(encoding="utf-8"))
        vault = str(bridge.get("vault") or "").strip()

        if vault:
            candidates.append(vault)
    except (OSError, ValueError):
        pass

    env_path = os.environ.get("VAULT_PATH", "").strip()

    if env_path:
        candidates.append(env_path)

    for candidate in candidates:
        root = Path(candidate).expanduser()

        if root.is_dir():
            return root

    return None


def _no_vault() -> str:
    return (
        "No vault is connected (VAULT_PATH unset). Ask the user to open or create "
        "a vault in BISEO first."
    )


def _resolve(root: Path, rel: str) -> Path | None:
    cleaned = rel.replace("\\", "/").lstrip("/")
    candidate = (root / cleaned).resolve()
    root_resolved = root.resolve()

    if candidate != root_resolved and root_resolved not in candidate.parents:
        return None

    return candidate


def vault_read(rel: str) -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    target = _resolve(root, rel)

    if not target:
        return f"Refused: '{rel}' escapes the vault."

    if not target.exists() and not rel.lower().endswith((".md", ".markdown")):
        alt = _resolve(root, rel + ".md")

        if alt and alt.exists():
            target = alt

    if not target.exists():
        return f"Not found: {rel}"

    try:
        content = target.read_text(encoding="utf-8")
    except Exception as error:  # noqa: BLE001 — surface the reason to the model
        return f"Could not read {rel}: {error}"

    if len(content) > MAX_READ_CHARS:
        return content[:MAX_READ_CHARS] + f"\n\n[... truncated, {len(content)} chars total]"

    return content


def vault_write(rel: str, content: str) -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    if not rel.lower().endswith((".md", ".markdown")):
        rel = rel + ".md"

    target = _resolve(root, rel)

    if not target:
        return f"Refused: '{rel}' escapes the vault."

    target.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.tmp-")

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)

        os.replace(tmp, target)
    except Exception as error:  # noqa: BLE001
        try:
            os.unlink(tmp)
        except OSError:
            pass

        return f"Could not write {rel}: {error}"

    return f"Wrote {rel} ({len(content)} chars)."


def vault_list(subdir: str = "") -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    base = _resolve(root, subdir or ".")

    if not base or not base.is_dir():
        return f"Not a folder: {subdir}"

    results: list[str] = []

    for path in sorted(base.rglob("*")):
        if len(results) >= MAX_LIST:
            results.append(f"[... more than {MAX_LIST} entries]")
            break

        if path.name.startswith("."):
            continue

        if path.is_file() and path.suffix.lower() in (".md", ".markdown"):
            results.append(str(path.relative_to(root)))

    return "\n".join(results) if results else "(no notes)"


def vault_search(query: str) -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    if not query.strip():
        return "Empty query."

    # ripgrep when available (installed by the runtime), python scan otherwise.
    try:
        proc = subprocess.run(
            ["rg", "--no-heading", "-n", "-i", "-m", "4", "-g", "*.md", "-g", "*.markdown", query, str(root)],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if proc.returncode in (0, 1):
            lines = proc.stdout.splitlines()[:MAX_SEARCH_RESULTS]
            rel_lines = [line.replace(str(root) + os.sep, "", 1) for line in lines]

            return "\n".join(rel_lines) if rel_lines else "No matches."
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    needle = query.lower()
    hits: list[str] = []

    for path in root.rglob("*.md"):
        if len(hits) >= MAX_SEARCH_RESULTS:
            break

        if path.name.startswith("."):
            continue

        try:
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if needle in line.lower():
                    hits.append(f"{path.relative_to(root)}:{number}:{line.strip()[:200]}")

                    if len(hits) >= MAX_SEARCH_RESULTS:
                        break
        except Exception:  # noqa: BLE001 — unreadable file, skip
            continue

    return "\n".join(hits) if hits else "No matches."


def _link_key(name: str) -> str:
    base = name.split("#")[0].strip()

    return unicodedata.normalize("NFC", base).lower()


def vault_backlinks(rel: str) -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    stem = Path(rel).name
    stem = re.sub(r"\.(md|markdown)$", "", stem, flags=re.I)

    # Preferred: the desktop's index (already resolves names/titles/paths).
    db_path = os.environ.get("VAULT_INDEX_DB", "").strip()

    if db_path and Path(db_path).exists():
        try:
            db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

            try:
                rel_norm = rel if rel.lower().endswith((".md", ".markdown")) else rel + ".md"
                rows = db.execute(
                    """
                    SELECT DISTINCT l.source FROM links l
                    JOIN notes n ON n.path = ?
                    WHERE l.target_key IN (n.path_key, n.name_key, n.title_key) AND l.source != n.path
                    ORDER BY l.source
                    """,
                    (rel_norm,),
                ).fetchall()
            finally:
                db.close()

            if rows:
                return "\n".join(row[0] for row in rows)

            return "No backlinks."
        except sqlite3.Error:
            pass  # index unavailable — fall through to the scan

    # Fallback: grep for [[Name ...]] mentions.
    return vault_search(f"[[{_link_key(stem)}")
