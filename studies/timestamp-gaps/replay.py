"""Replay the real executable against adjacent-row arithmetic, without npm deps."""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SOURCE_SHA256 = "3034ff1dc1db38567396acbb8ae9ad763a018b6e63baf27401d0b6305a1bd405"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "dist-cli/cli/index.js")
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    source = (ROOT / "examples/controlled-browser/controlled-b.csv").read_bytes()
    assert sha(source) == SOURCE_SHA256
    original = list(csv.DictReader(io.StringIO(source.decode())))
    results = {}
    for name in ["complete", "missing"]:
        fixture = HERE / f"{name}.csv"
        rows = list(csv.DictReader(io.StringIO(fixture.read_text())))
        assert len(rows) == len(original)
        for row, captured in zip(rows, original):
            expected = "" if name == "missing" and 150 <= int(row["frame"]) <= 152 else captured["elapsed_ms"]
            assert row == {"frame": captured["frame"], "elapsed_ms": expected}
        # Do not filter missing values first: both adjacent observations must exist.
        intervals = [(line, float(b["elapsed_ms"]) - float(a["elapsed_ms"]))
                     for line, (a, b) in enumerate(zip(rows, rows[1:]), 3)
                     if a["elapsed_ms"] and b["elapsed_ms"]]
        expected = {"frames": len(intervals), "durationMs": math.fsum(ms for _, ms in intervals),
                    "hitchSourceLines": [line for line, ms in intervals if ms > 50]}
        proc = subprocess.run([args.node, str(args.cli), "summary", str(fixture), "--format", "generic",
                               "--generic-column", "elapsed_ms", "--generic-kind", "timestamp_ms_cumulative",
                               "--events", "--json"], capture_output=True, text=True, check=True)
        report = json.loads(proc.stdout)
        summary = report["summary"]
        observed = {"frames": summary["frameCount"], "durationMs": summary["durationSec"] * 1000,
                    "hitches": summary["stutter"]["hitchCount"],
                    "stutterFrames": summary["stutter"]["stutterEventCount"],
                    "skippedRows": report["source"]["skippedRows"],
                    "warnings": report["source"]["warnings"], "episodes": report["episodes"]}
        agrees = (observed["frames"] == expected["frames"]
                  and math.isclose(observed["durationMs"], expected["durationMs"], abs_tol=1e-7)
                  and observed["hitches"] == len(expected["hitchSourceLines"]))
        results[name] = {"sha256": sha(fixture.read_bytes()), "oracle": expected,
                         "observed": observed, "agrees": agrees}
    tree = args.cli.resolve().parent.parent
    receipt = {"node": subprocess.check_output([args.node, "--version"], text=True).strip(),
               "sourceCaptureSha256": SOURCE_SHA256,
               "runtimeSha256": {p.relative_to(tree).as_posix(): sha(p.read_bytes()) for p in sorted(tree.rglob("*.js"))},
               "cases": results}
    args.out.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({name: {"frames": r["observed"]["frames"], "hitches": r["observed"]["hitches"],
                            "agrees": r["agrees"]} for name, r in results.items()}))
    if args.verify:
        assert all(r["agrees"] for r in results.values())


if __name__ == "__main__":
    main()
