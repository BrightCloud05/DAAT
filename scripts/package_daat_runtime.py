"""Package the exact staged DAAT runtime; never package a working tree wholesale."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


def package(source: Path, destination: Path, revision: str, upstream: str, desktop: str):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("An immutable commit SHA is required")
    if not re.fullmatch(r"v[\w.-]+", upstream) or not re.fullmatch(r"\d+\.\d+\.\d+", desktop):
        raise ValueError("Invalid release versions")
    for required in ("pyproject.toml", "uv.lock", "plugins/vault/__init__.py",
                     "plugins/memory/vault/__init__.py", "scripts/verify_daat_runtime.py"):
        if not (source / required).is_file():
            raise ValueError(f"Missing required DAAT capability: {required}")
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "daat-runtime.zip"
    executables = []
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as output:
        for file in sorted(source.rglob("*")):
            if file.is_symlink():
                raise ValueError(f"Runtime symlink is not allowed: {file}")
            if not file.is_file():
                continue
            name = file.relative_to(source).as_posix()
            if any(part in {".git", ".env", "venv", ".venv", "__pycache__"} for part in file.relative_to(source).parts):
                raise ValueError(f"Private or generated runtime file: {name}")
            if file.stat().st_mode & 0o111:
                executables.append(name)
            output.write(file, name)
    content = archive.read_bytes()
    manifest = dict(format=1, revision=revision, upstream=upstream, minimumDesktopVersion=desktop,
                    sha256=hashlib.sha256(content).hexdigest(), bytes=len(content), executables=executables)
    (destination / "daat-runtime.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--desktop-version", required=True)
    args = parser.parse_args()
    package(args.source, args.output, args.revision, args.upstream, args.desktop_version)
