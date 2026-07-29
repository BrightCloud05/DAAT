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
import time
import unicodedata
from pathlib import Path

MAX_READ_CHARS = 120_000
MAX_LIST = 400
MAX_SEARCH_RESULTS = 40
MAX_WALK_ENTRIES = 20_000

# Folders that exist for the app, not the user. Listing or searching them
# surfaces deleted notes and app state as if they were real content.
SKIP_DIRS = {".trash", ".obsidian", ".biseo", ".git", ".stversions", "node_modules"}

# Captured at import (backend start). A bridge file older than this is a
# leftover from a previous run and must not outrank the env the desktop
# just spawned us with.
_STARTED_AT = time.time()


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
    bridge_path = _bridge_file()

    try:
        import json

        fresh = bridge_path.stat().st_mtime >= _STARTED_AT - 1
        bridge = json.loads(bridge_path.read_text(encoding="utf-8"))
        vault = str(bridge.get("vault") or "").strip()

        if vault and fresh:
            candidates.append(vault)
    except (OSError, ValueError):
        fresh = False

    env_path = os.environ.get("VAULT_PATH", "").strip()

    if env_path:
        candidates.append(env_path)

    # A stale bridge is still better than nothing when the env is unset.
    if not candidates and not fresh:
        try:
            import json

            stale = str(json.loads(bridge_path.read_text(encoding="utf-8")).get("vault") or "").strip()

            if stale:
                candidates.append(stale)
        except (OSError, ValueError):
            pass

    for candidate in candidates:
        root = Path(candidate).expanduser()

        try:
            if root.is_dir():
                # Resolve once: every later relative_to() compares against
                # this, and a symlinked vault root would never match.
                return root.resolve()
        except OSError:
            continue

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


def _backup_existing(target: Path, rel: str) -> str | None:
    """Copy the file we are about to replace outside the vault.

    vault_write has no expected-mtime to check against, so it can overwrite a
    note the user is editing right now. Keeping the old bytes makes that
    recoverable instead of silent. Backups live in HERMES_HOME, never in the
    vault, so they never appear as notes or reach iCloud.
    """
    if not target.is_file():
        return None

    try:
        previous = target.read_bytes()
    except OSError:
        return None

    home = os.environ.get("HERMES_HOME", "").strip() or str(Path.home() / ".biseo")
    folder = Path(home) / "state" / "vault-backups"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", rel)[-80:]
    backup = folder / f"{stamp}-{safe}"

    try:
        backup.write_bytes(previous)
    except OSError:
        return None

    # Keep the folder from growing without bound.
    try:
        entries = sorted(folder.iterdir(), key=lambda item: item.name)

        for old in entries[:-200]:
            old.unlink(missing_ok=True)
    except OSError:
        pass

    return str(backup)


def vault_read(rel: str) -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    target = _resolve(root, rel)

    if not target:
        return f"Refused: '{rel}' escapes the vault."

    try:
        if not target.exists() and not rel.lower().endswith((".md", ".markdown")):
            alt = _resolve(root, rel + ".md")

            if alt and alt.exists():
                target = alt

        if not target.exists():
            return f"Not found: {rel}"

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

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        replaced = _backup_existing(target, rel)
    except OSError as error:
        return f"Could not write {rel}: {error}"

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

    if replaced:
        return (
            f"Wrote {rel} ({len(content)} chars). The previous version was kept at {replaced} "
            "in case the user had unsaved edits."
        )

    return f"Wrote {rel} ({len(content)} chars)."


def _walk_notes(base: Path):
    """Yield markdown files under `base`, pruning app folders as we go.

    os.walk lets us prune whole directories (a 10k-note .trash costs nothing);
    Path.rglob('*') would materialize every entry in the vault first.
    """
    seen = 0

    for current, dirs, files in os.walk(base, followlinks=False):
        dirs[:] = sorted(
            name for name in dirs if not name.startswith(".") and name.lower() not in SKIP_DIRS
        )

        for name in sorted(files):
            seen += 1

            if seen > MAX_WALK_ENTRIES:
                return

            if name.startswith(".") or not name.lower().endswith((".md", ".markdown")):
                continue

            yield Path(current) / name


def vault_list(subdir: str = "") -> str:
    root = _vault_root()

    if not root:
        return _no_vault()

    base = _resolve(root, subdir or ".")

    if not base or not base.is_dir():
        return f"Not a folder: {subdir}"

    results: list[str] = []
    truncated = False

    for note in _walk_notes(base):
        if len(results) >= MAX_LIST:
            truncated = True
            break

        try:
            results.append(str(note.relative_to(root)))
        except ValueError:
            continue

    results.sort()

    if truncated:
        results.append(f"[... more than {MAX_LIST} notes; narrow the subdir]")

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
            [
                "rg",
                "--no-heading",
                "-n",
                "-i",
                "-m",
                "4",
                # -F: the user's words are a literal phrase, not a regex.
                # -e: bind the query to the pattern flag, and `--` ends option
                # parsing — without both, a query like "--pre=bash" is read as
                # a flag and ripgrep executes it on every file (verified RCE).
                "-F",
                "-e",
                query,
                "-g",
                "*.md",
                "-g",
                "*.markdown",
                *(f"-g!{name}/" for name in sorted(SKIP_DIRS)),
                "-g",
                "!.*/",
                "--",
                str(root),
            ],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )

        if proc.returncode in (0, 1):
            lines = proc.stdout.splitlines()[:MAX_SEARCH_RESULTS]
            rel_lines = [line.replace(str(root) + os.sep, "", 1) for line in lines]

            return "\n".join(rel_lines) if rel_lines else "No matches."
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        pass

    needle = query.lower()
    hits: list[str] = []

    for path in _walk_notes(root):
        if len(hits) >= MAX_SEARCH_RESULTS:
            break

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
