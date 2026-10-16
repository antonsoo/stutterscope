"""Measure complete CLI analysis of the unchanged public 112,316-frame example."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import time

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    corpus = HERE.parent / "real-captures"
    source = next(f for f in json.loads((corpus / "manifest.json").read_text())["files"] if f["path"] == "examples/frameview-1-6.csv")
    path = corpus / source["local"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source["sha256"]
    runs = {"before": [], "after": []}
    for trial in range(5):
        for phase in (["before", "after"] if trial % 2 == 0 else ["after", "before"]):
            cli = getattr(args, phase)
            start = time.perf_counter()
            result = subprocess.run(["/usr/bin/time", "-f", "rss_kib=%M", "node", str(cli), "summary", str(path), "--json"], capture_output=True, text=True, check=True)
            milliseconds = (time.perf_counter() - start) * 1000
            report = json.loads(result.stdout)
            assert report["summary"]["frameCount"] == 112316
            assert report["summary"]["pacingCoverage"]["gapBoundaries"] == (1 if phase == "after" else 0)
            runs[phase].append(dict(elapsedMs=milliseconds, maxRssKiB=int(re.search(r"rss_kib=(\d+)", result.stderr)[1])))
    args.out.write_text(json.dumps(dict(scope="Five alternating fresh CLI processes per build on one unchanged cached public FrameView capture. Includes startup, file decoding, parsing, metrics and JSON. Not general performance evidence.",
        machine=dict(platform="WSL2 Linux", logicalCpus=os.cpu_count(), node=subprocess.check_output(["node", "--version"], text=True).strip()),
        input=dict(url=source["url"], bytes=source["bytes"], sha256=source["sha256"]), runs=runs,
        medians={phase: {key: statistics.median(row[key] for row in rows) for key in ["elapsedMs", "maxRssKiB"]} for phase, rows in runs.items()},
        implementation={phase: hashlib.sha256(getattr(args, phase).read_bytes()).hexdigest() for phase in runs}), indent=2) + "\n")
    print(args.out.read_text())


if __name__ == "__main__":
    main()
