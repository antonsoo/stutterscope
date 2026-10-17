"""Check real native imports against independent calculations from saved arrays.

python3 replay.py [--repo /path/to/source] [--output results/after.json]
The pinned inputs must first be fetched with fetch.py. No raw metadata is retained.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import time

HERE = Path(__file__).resolve().parent

def percentile(values, percent):
    x = (len(values) - 1) * percent / 100
    lo = math.floor(x)
    hi = math.ceil(x)
    return values[lo] + (values[hi] - values[lo]) * (x - lo)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=HERE.parent.parent)
    parser.add_argument("--output", type=Path, default=HERE / "results" / "after.json")
    args = parser.parse_args()
    results = []
    for item in json.loads((HERE / "manifest.json").read_text())["files"]:
        path = HERE / "cache" / item["file"]
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item["sha256"]
        source = json.loads(raw)
        assert len(source["Runs"]) == 1
        data = source["Runs"][0]["CaptureData"]
        frames = data["MsBetweenPresents"]
        assert all(type(x) in (float, int) and math.isfinite(x) and x >= 0 for x in frames)
        ordered = sorted(frames)
        expected = {"frameCount": len(frames), "durationSec": math.fsum(frames) / 1000,
                    "averageFps": len(frames) * 1000 / math.fsum(frames),
                    "p99": percentile(ordered, 99), "p999": percentile(ordered, 99.9),
                    "masdMs": math.fsum(abs(a-b) for a,b in zip(frames, frames[1:])) / (len(frames)-1),
                    "droppedCount": sum(x is True for x in data["Dropped"])}
        start = time.perf_counter()
        run = subprocess.run(["node", str(args.repo / "src/cli/index.ts"), "summary", str(path), "--events", "--json"], capture_output=True, text=True, timeout=120)
        result = {"file": item["file"], "sha256": item["sha256"], "bytes": len(raw), "appVersion": source["Info"]["AppVersion"],
                  "expected": expected, "exitCode": run.returncode, "cliSeconds": time.perf_counter()-start}
        if run.returncode:
            # Paths are local; retain the actual diagnosis without machine-specific prefixes.
            result["error"] = run.stderr.strip().replace(str(path), item["file"])
            result["matches"] = False
        else:
            report = json.loads(run.stdout)
            actual = report["summary"]
            observed = {key: actual[key] for key in ("frameCount", "durationSec", "averageFps", "masdMs")}
            observed.update(p99=actual["percentilesMs"]["p99"], p999=actual["percentilesMs"]["p999"], droppedCount=actual["dropped"]["droppedCount"])
            result["observed"] = observed
            result["matches"] = all(math.isclose(observed[k], v, rel_tol=1e-11, abs_tol=1e-10) for k,v in expected.items())
            result["recording"] = report["source"]["nativeCapture"]
            result["pacingCoverage"] = actual["pacingCoverage"]
            result["episodeCount"] = len(report["episodes"])
            # Every retained episode coordinate is checked against the original saved array.
            for episode in report["episodes"]:
                first, last = episode["firstSourceSample"], episode["lastSourceSample"]
                assert episode["firstSourceLine"] is None and episode["lastSourceLine"] is None
                assert 0 <= first <= last < len(frames)
                assert episode["firstFrame"] == first+1 and episode["lastFrame"] == last+1
                assert math.isclose(episode["longestFrameMs"], max(frames[first:last+1]), rel_tol=1e-12)
            assert result["matches"], result
            assert actual["pacingCoverage"] == {"observedPairs": len(frames)-1, "gapBoundaries": 0}
        results.append(result)
        print(item["file"], "matches" if result["matches"] else "refused", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"sourceCommit": subprocess.check_output(["git", "-C", str(args.repo), "rev-parse", "HEAD"], text=True).strip(),
                                       "sourceDirty": bool(subprocess.check_output(["git", "-C", str(args.repo), "status", "--porcelain"], text=True)),
                                       "oracle": "Python standard-library JSON arrays, math.fsum, independent type-7 percentiles and adjacent differences; no analyzer imports",
                                       "files": results}, indent=2) + "\n")

if __name__ == "__main__":
    main()
