"""Release artifacts must preserve the staged source and reject private state."""
import hashlib
import json
import zipfile

import pytest

from scripts.package_daat_runtime import package


def source_tree(tmp_path):
    source = tmp_path / "source"
    for name in ("pyproject.toml", "uv.lock", "plugins/vault/__init__.py",
                 "plugins/memory/vault/__init__.py", "scripts/verify_daat_runtime.py"):
        file = source / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(f"fixture {name}")
    return source


def test_manifest_describes_the_exact_staged_archive(tmp_path):
    source = source_tree(tmp_path)
    executable = source / "scripts/verify_daat_runtime.py"
    executable.chmod(0o755)
    output = tmp_path / "out"
    package(source, output, "a" * 40, "v1.2.3", "0.17.0")
    manifest = json.loads((output / "daat-runtime.json").read_text())
    archive = output / "daat-runtime.zip"
    assert manifest["sha256"] == hashlib.sha256(archive.read_bytes()).hexdigest()
    assert manifest["bytes"] == archive.stat().st_size
    assert "scripts/verify_daat_runtime.py" in manifest["executables"]
    with zipfile.ZipFile(archive) as files:
        for file in source.rglob("*"):
            if file.is_file():
                assert files.read(file.relative_to(source).as_posix()) == file.read_bytes()


def test_private_state_and_incomplete_runtime_cannot_be_published(tmp_path):
    source = source_tree(tmp_path)
    (source / ".env").write_text("PRIVATE_FIXTURE=not-a-real-secret")
    with pytest.raises(ValueError, match="Private"):
        package(source, tmp_path / "private", "a" * 40, "v1.2.3", "0.17.0")
    assert not (tmp_path / "private/daat-runtime.json").exists()
    (source / ".env").unlink()
    (source / "plugins/memory/vault/__init__.py").unlink()
    with pytest.raises(ValueError, match="Missing required"):
        package(source, tmp_path / "incomplete", "a" * 40, "v1.2.3", "0.17.0")
