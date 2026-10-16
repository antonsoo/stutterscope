"""Replay actual CLI output against independent retained-record adjacency.

python3 studies/present-clock/replay.py --cli src/cli/index.ts --out OUTPUT [--verify]
"""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent


def close(a, b):
    return a is None and b is None or isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    baseline = json.loads((HERE / "results/before.json").read_text()) if args.verify else None
    cases = []
    for case in json.loads((HERE / "cases.json").read_text())["cases"]:
        path = HERE / case["file"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == case["input"]["sha256"]
        process = subprocess.run([args.node, str(args.cli.resolve()), "summary", str(path), "--json", "--events", *case["options"]], capture_output=True, text=True, timeout=30)
        report = json.loads(process.stdout) if process.returncode == 0 else None
        differences = []
        if report is None:
            differences.append("CLI refusal: " + process.stderr.strip().replace(str(path), "<input>"))
        else:
            report["file"] = path.name
            current = report["summary"]
            expected = case["expected"]
            observed = dict(frames=current["frameCount"], gaps=report["analysis"]["continuity"]["gaps"], observedPairs=current["pacingCoverage"]["observedPairs"],
                masdMs=current["masdMs"], averageFps=current["averageFps"], stream=report["source"].get("stream"), episodes=len(report["episodes"]), hitches=current["stutter"]["hitchCount"])
            for key, value in expected.items():
                if not (close(observed[key], value) if isinstance(value, (int, float)) or value is None else observed[key] == value):
                    differences.append(key)
            if args.verify:
                before = next(c for c in baseline["cases"] if c["name"] == case["name"])["report"]
                for key in current:
                    if key not in {"masdMs", "pacingCoverage", "stutter"}:
                        assert current[key] == before["summary"][key], (case["name"], key)
                for key in ["hitchCount", "totalHitchTimeMs", "hitchTimeFraction"]:
                    assert current["stutter"][key] == before["summary"]["stutter"][key]
                if case.get("unchanged"):
                    assert report == before, (case["name"], "unfiltered full report changed")
                if expected["gaps"]:
                    assert report["source"]["presentClockGaps"] == len(expected["gaps"])
                    evidence = report["source"]["presentClockEvidence"]
                    assert len(evidence["witnesses"]) == min(5, len(expected["gaps"]))
                    assert evidence["omittedWitnesses"] == len(expected["gaps"]) - len(evidence["witnesses"])
                    assert [w["toSourceLine"] for w in evidence["witnesses"]] == [g["sourceLine"] for g in expected["gaps"][:5]]
                    rows = list(csv.reader(path.read_text(encoding="utf-8-sig").splitlines()))
                    header = next(row for row in rows if "TimeInSeconds" in row)
                    clock_column = header.index("TimeInSeconds")
                    frame_column = header.index("msBetweenPresents" if "msBetweenPresents" in header else "MsBetweenPresents")
                    for witness in evidence["witnesses"]:
                        previous, current_row = (rows[witness[key]-1] for key in ["fromSourceLine", "toSourceLine"])
                        elapsed = (Decimal(current_row[clock_column]) - Decimal(previous[clock_column])) * 1000
                        assert math.isclose(witness["elapsedMs"], float(elapsed), abs_tol=1e-9)
                        assert witness["frameTimeMs"] == float(Decimal(current_row[frame_column]))
                        assert all(math.isfinite(witness[key]) for key in ["elapsedMs", "frameTimeMs", "allowanceMs"])
                        if witness["kind"] == "reversed_clock":
                            assert witness["elapsedMs"] < -witness["allowanceMs"]
                        else:
                            assert witness["elapsedMs"] > witness["frameTimeMs"] + witness["allowanceMs"]
        value = dict(name=case["name"], input=case["input"], expected=case["expected"], differences=differences, report=report)
        if args.verify:
            assert not differences, (case["name"], differences)
        cases.append(value)
    output = dict(node=subprocess.check_output([args.node, "--version"], text=True).strip(), oracle="Native per-stream record ordinals before filtering; explicit boundaries for constructed controls.",
        cases=cases, discrepancies=sum(bool(c["differences"]) for c in cases))
    args.out.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(dict(cases=len(cases), discrepancies=output["discrepancies"])))


if __name__ == "__main__":
    main()
