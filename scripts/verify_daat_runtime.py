"""Offline acceptance probe for the staged/installed DAAT runtime.

Run in a fresh process so plugin discovery sees only the temporary profile.
No model requests or access to the user's actual notes are needed.
"""
import os
from pathlib import Path
import tempfile


def main():
    with tempfile.TemporaryDirectory(prefix="daat-capability-check-") as temporary:
        root = Path(temporary)
        notes = root / "notes"
        notes.mkdir()
        os.environ["HERMES_HOME"] = str(root / "profile")
        os.environ["VAULT_PATH"] = str(notes)

        import run_agent  # noqa: F401
        import tui_gateway.server  # noqa: F401
        from plugins.memory import load_memory_provider
        from plugins.vault.tools import vault_read, vault_write

        marker = "DAAT runtime verification: durable notes remain available."
        vault_write("verification.md", marker)
        if vault_read("verification.md") != marker:
            raise RuntimeError("DAAT note write/read failed")
        provider = load_memory_provider("vault", register_skills=False)
        if provider is None or not provider.is_available():
            raise RuntimeError("DAAT vault memory provider is unavailable")
        provider.on_memory_write("add", "memory", marker)
        if not any(marker in note.read_text() for note in (notes / "Inbox").glob("*.md")):
            raise RuntimeError("DAAT memory did not reach its built-in notes")
        print("DAAT note persistence and memory discovery verified")


if __name__ == "__main__":
    main()
