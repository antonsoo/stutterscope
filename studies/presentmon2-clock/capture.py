"""Regenerate the retained CSVs with official PresentMon on Windows via WSL.

Only offline ETL analysis is run. The executable and traces are checksum-pinned.
Write a receipt before exiting 2 for any byte differences: repeated CPU-only
native replays have produced different records. Retained fixtures are untouched.
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


def verify(path, record):
    assert fingerprint(path) == {key: record[key] for key in ["bytes", "sha256"]}, path.name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((HERE / "manifest.json").read_text())
    executable = manifest["executable"]
    exe = cache / executable["url"].split("/")[-1]
    for path, record in [(exe, executable), *[(cache / t["file"], t) for t in manifest["traces"]]]:
        if not path.exists():
            with urllib.request.urlopen(record["url"], timeout=60) as response:
                data = response.read()
            assert hashlib.sha256(data).hexdigest() == record["sha256"]
            path.write_bytes(data)
        verify(path, record)
    exe.chmod(0o755)

    def windows(path):
        return subprocess.check_output(["wslpath", "-w", str(path)], text=True).strip()

    results = []
    for capture in manifest["captures"]:
        dest = cache / ("replayed-" + capture["file"])
        command = [str(exe), "--etl_file", windows(cache / capture["trace"]),
                   "--output_file", windows(dest), "--no_console_stats", *capture["flags"]]
        process = subprocess.run(command, capture_output=True, text=True, timeout=40)
        actual = fingerprint(dest) if dest.exists() else None
        wanted = {key: capture[key] for key in ["bytes", "sha256"]}
        results.append(dict(file=capture["file"], exitCode=process.returncode,
                            expected=wanted, actual=actual,
                            matches=process.returncode == capture["exitCode"] and actual == wanted,
                            stderr=process.stderr.strip()))
    receipt = dict(captures=results, matches=sum(r["matches"] for r in results),
                   total=len(results), note="Byte differences remain differences; fixtures are not replaced.")
    args.out.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(dict(captures=receipt["total"], matches=receipt["matches"])))
    raise SystemExit(0 if all(r["matches"] for r in results) else 2)


if __name__ == "__main__":
    main()
