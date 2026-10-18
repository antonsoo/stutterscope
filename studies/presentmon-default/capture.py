"""Recapture with official PresentMon 2.6.0, using offline ETLs on Windows/WSL.

Download only checksum-pinned inputs; retain results in the requested cache.
Never overwrite fixtures. Native rerender byte differences remain differences.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

HERE = Path(__file__).resolve().parent


def fingerprint(path):
    data = path.read_bytes()
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((HERE / "manifest.json").read_text())
    inputs = [manifest["executable"], *manifest["traces"]]
    for record in inputs:
        path = cache / record["url"].rsplit("/", 1)[-1]
        if not path.exists():
            path.write_bytes(urllib.request.urlopen(record["url"], timeout=45).read())
        assert fingerprint(path) == {key: record[key] for key in ["bytes", "sha256"]}
    exe = cache / inputs[0]["url"].rsplit("/", 1)[-1]
    exe.chmod(0o755)

    def windows(path):
        return subprocess.check_output(["wslpath", "-w", str(path)], text=True).strip()

    captures = []
    for fixture in manifest["captures"]:
        if "trace" not in fixture:
            continue
        target = cache / ("recaptured-" + fixture["file"])
        command = [str(exe), "--etl_file", windows(cache / fixture["trace"]),
                   "--output_file", windows(target), "--no_console_stats", *fixture["flags"]]
        result = subprocess.run(command, capture_output=True, text=True, timeout=40)
        actual = fingerprint(target) if target.exists() else None
        wanted = {key: fixture[key] for key in ["bytes", "sha256"]}
        captures.append(dict(file=fixture["file"], exitCode=result.returncode,
                             expected=wanted, actual=actual, stderr=result.stderr.strip(),
                             matches=result.returncode == 0 and actual == wanted))
        print(fixture["file"], captures[-1]["matches"], flush=True)
    receipt = dict(captures=captures, total=len(captures), matches=sum(c["matches"] for c in captures))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(receipt, indent=2) + "\n")
    raise SystemExit(0 if receipt["total"] == receipt["matches"] else 2)


if __name__ == "__main__":
    main()
