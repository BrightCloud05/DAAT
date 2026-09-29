"""Merge the latest stable Hermes release into an isolated CI checkout.

No remote writes. A conflict fails the job and leaves the default branch intact.
The resulting bundle is handed to a separate job with narrowly scoped write access.
"""
import json
import os
from pathlib import Path
import re
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    release = json.loads(run("gh", "api", "repos/NousResearch/hermes-agent/releases/latest"))
    tag = release["tag_name"]
    if release["draft"] or release["prerelease"] or not re.fullmatch(r"v[\w.-]+", tag):
        raise ValueError("Expected a stable Hermes release")
    base = run("git", "rev-parse", "HEAD")
    run("git", "fetch", "--no-tags", "https://github.com/NousResearch/hermes-agent.git", f"refs/tags/{tag}")
    upstream = run("git", "rev-parse", "FETCH_HEAD^{commit}")
    metadata = Path("daat-upstream.json")
    previous = json.loads(metadata.read_text()) if metadata.exists() else {}
    if previous.get("commit") == upstream:
        return
    run("git", "config", "user.name", "DAAT release automation")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "checkout", "-b", f"codex/hermes-{upstream}")
    run("git", "merge", "--no-edit", "--no-ff", upstream)
    metadata.write_text(json.dumps({"tag": tag, "commit": upstream}, indent=2) + "\n")
    run("git", "add", "daat-upstream.json")
    run("git", "commit", "-m", f"Track Hermes {tag}")
    run("git", "bundle", "create", "/tmp/daat-sync.bundle", "HEAD", f"^{base}")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"changed=true\nbranch=codex/hermes-{upstream}\n")


if __name__ == "__main__":
    main()
