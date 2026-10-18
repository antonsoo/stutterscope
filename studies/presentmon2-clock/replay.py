"""Compare CLI pacing with original per-stream ordinals before native filtering.

Run from the repository root. The oracle does not read clock differences or
call Stutterscope's continuity detector. No Windows executable is needed.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def identity(row):
    return row["ProcessID"], row["SwapChainAddress"]


def expected(original, captured):
    groups = {}
    for line, row in enumerate(captured, 2):
        groups.setdefault(identity(row), []).append((line, row))
    ranked = sorted(groups.values(), key=len, reverse=True)
    selected = next((g for g in ranked if g[0][1]["Application"] != "dwm.exe"), ranked[0])
    stream = identity(selected[0][1])
    original_stream = [row for row in original if identity(row) == stream]
    # A unique complete row identifies its position without interpreting a clock.
    ordinals = {tuple(row.values()): i for i, row in enumerate(original_stream)}
    assert len(ordinals) == len(original_stream)
    positions = [ordinals[tuple(row.values())] for _, row in selected]
    gaps = [dict(beforeFrame=i + 1, sourceLine=selected[i][0])
            for i in range(1, len(selected)) if positions[i] != positions[i - 1] + 1]
    times = [float(row["FrameTime"]) for _, row in selected]
    differences = [abs(times[i] - times[i - 1]) for i in range(1, len(times))
                   if positions[i] == positions[i - 1] + 1]
    return dict(format="presentmon2", stream=":".join(stream),
                averageFps=len(times) * 1000 / sum(times),
                frames=len(times), gaps=gaps, observedPairs=len(differences),
                masdMs=sum(differences) / len(differences) if differences else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=Path("src/cli/index.ts"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((HERE / "manifest.json").read_text())
    before = json.loads((HERE / "results/before.json").read_text()) if args.verify else None
    cases = []
    for capture in manifest["captures"]:
        path = HERE / "fixtures" / capture["file"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == capture["sha256"]
        original_name = capture["file"].replace("-filtered", "")
        if capture["flags"] == ["--exclude_dropped"]:
            original_name = capture["file"].replace("-filtered", "-default")
        oracle = expected(rows(HERE / "fixtures" / original_name), rows(path))
        process = subprocess.run(["node", str(args.cli.resolve()), "summary", str(path),
                                  "--json", "--events"], capture_output=True, text=True, timeout=30)
        assert process.returncode == 0, process.stderr
        report = json.loads(process.stdout)
        summary = report["summary"]
        actual = dict(format=report["format"], stream=report["source"].get("stream"),
                      averageFps=summary["averageFps"],
                      frames=summary["frameCount"], gaps=report["analysis"]["continuity"]["gaps"],
                      observedPairs=summary["pacingCoverage"]["observedPairs"],
                      masdMs=summary["masdMs"])
        differences = [key for key, value in oracle.items() if
                       not (math.isclose(actual[key], value, rel_tol=1e-12, abs_tol=1e-12)
                            if isinstance(value, float) else actual[key] == value)]
        source = report["source"]
        case = dict(name=capture["file"], expected=oracle, actual=actual,
                    differences=differences, summary=summary, source=source)
        if args.verify:
            assert not differences, (capture["file"], differences)
            old = next(c for c in before["cases"] if c["name"] == capture["file"])
            changed_detection = "--no_track_gpu" in capture["flags"]
            if not changed_detection:
                for key in summary.keys() - {"masdMs", "pacingCoverage", "stutter"}:
                    assert summary[key] == old["summary"][key], (capture["file"], key)
            if not oracle["gaps"] and not changed_detection:
                assert summary == old["summary"] and source == old["source"]
            if oracle["gaps"]:
                evidence = source["presentClockEvidence"]
                assert evidence["frameTimeReference"] == "fromSourceLine"
                clock = evidence["clockColumn"]
                cells = rows(path)
                for witness in evidence["witnesses"]:
                    earlier = cells[witness["fromSourceLine"] - 2]
                    later = cells[witness["toSourceLine"] - 2]
                    assert witness["frameTimeMs"] == float(earlier["FrameTime"])
                    assert math.isclose(witness["elapsedMs"],
                        float(later[clock]) - float(earlier[clock]), abs_tol=1e-6)
                assert source["presentClockGaps"] == len(oracle["gaps"])
        cases.append(case)
    output = dict(baseline=manifest["baseline"], oracle="Per-stream original record ordinals before filtering",
                  cases=cases, discrepancies=sum(bool(c["differences"]) for c in cases))
    args.out.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(dict(cases=len(cases), discrepancies=output["discrepancies"])))


if __name__ == "__main__":
    main()
