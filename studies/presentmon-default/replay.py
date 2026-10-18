"""Check the actual CLI against native rows and unfiltered source ordinals.

The oracle uses Python CSV and Decimal, without importing Stutterscope or
subtracting native clocks to decide which filtered records were consecutive.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def number(value):
    try:
        result = Decimal(value)
        return result if result.is_finite() and result >= 0 else None
    except (InvalidOperation, TypeError):
        return None


def stream(row):
    return row["ProcessID"] + ":" + row["SwapChainAddress"]


def expected(path):
    data = rows(path)
    v2 = "FrameTime" in data[0]
    duration = "FrameTime" if v2 else "MsBetweenPresents"
    streams = defaultdict(list)
    for line, row in enumerate(data, 2):
        if number(row[duration]) is not None:
            streams[stream(row)].append((line, row))
    ordered = sorted(streams, key=lambda key: -len(streams[key]))
    selected = next((key for key in ordered
                     if streams[key][0][1]["Application"].lower() != "dwm.exe"), ordered[0])
    kept = streams[selected]
    cpu_key, gpu_key = ("CPUBusy", "GPUBusy") if v2 else ("MsCPUBusy", "MsGPUBusy")
    latency_key = "DisplayLatency" if v2 else "MsUntilDisplayed"
    cpu = gpu = 0
    for _, row in kept:
        c, g = number(row.get(cpu_key)), number(row.get(gpu_key))
        if c is not None and g is not None:
            cpu += c >= g
            gpu += c < g
    latency = [n for _, row in kept if (n := number(row.get(latency_key))) is not None]
    gaps = []
    if "filtered" in path.stem:
        original = path.with_name(path.name.replace("qpc-ms-filtered", "qpc-ms")
                                  .replace("-filtered", "-default"))
        clock = "CPUStartQPCTimeInMs" if "qpc-ms" in path.stem else "TimeInMs"
        full = [row for row in rows(original) if stream(row) == selected]
        # Each retained record must be an unchanged native record in its original
        # stream. Ordinal jumps expose removed records without a clock formula.
        positions = {row[clock]: (i, row) for i, row in enumerate(full)}
        assert len(positions) == len(full), "native clock does not uniquely identify rows"
        ordinals = []
        for _, row in kept:
            index, reference = positions[row[clock]]
            assert row == reference, "native filtering changed a retained observation"
            ordinals.append(index)
        for index in range(1, len(kept)):
            if ordinals[index] != ordinals[index - 1] + 1:
                gaps.append(dict(beforeFrame=index + 1, sourceLine=kept[index][0]))
    times = [number(row[duration]) for _, row in kept]
    pairs = [(a, b) for index, (a, b) in enumerate(zip(times, times[1:]), 2)
             if index not in {gap["beforeFrame"] for gap in gaps}]
    total = sum(times, Decimal(0))
    return dict(format="presentmon2" if v2 else "presentmon", stream=selected,
                frames=len(kept), averageFps=float(Decimal(len(kept)) * 1000 / total),
                gaps=gaps, observedPairs=len(pairs),
                masdMs=float(sum(abs(a - b) for a, b in pairs) / len(pairs)) if pairs else None,
                cpuBoundFrames=cpu if cpu + gpu else None,
                gpuBoundFrames=gpu if cpu + gpu else None,
                latencyFrames=len(latency) if latency_key in data[0] else None,
                latencyMeanMs=float(sum(latency) / len(latency)) if latency else None)


def observed(report):
    summary = report["summary"]
    busy, latency = summary["boundShare"], summary["latency"]
    coverage = summary["telemetryCoverage"]["displayLatency"]
    return dict(format=report["source"]["format"], stream=report["source"].get("stream"),
                frames=summary["frameCount"], averageFps=summary["averageFps"],
                gaps=report["analysis"]["continuity"]["gaps"],
                observedPairs=summary["pacingCoverage"]["observedPairs"], masdMs=summary["masdMs"],
                cpuBoundFrames=busy["cpuBoundFrames"] if busy else None,
                gpuBoundFrames=busy["gpuBoundFrames"] if busy else None,
                latencyFrames=coverage["observedFrames"] if coverage else None,
                latencyMeanMs=latency["meanMs"] if latency else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=Path("src/cli/index.ts"))
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text()) if args.baseline else None
    manifest = json.loads((HERE / "manifest.json").read_text())
    cases = []
    for fixture in manifest["captures"]:
        path = HERE / "fixtures" / fixture["file"]
        raw = path.read_bytes()
        assert len(raw) == fixture["bytes"]
        assert hashlib.sha256(raw).hexdigest() == fixture["sha256"]
        wanted = expected(path)
        result = subprocess.run([args.node, str(args.cli.resolve()), "summary", str(path), "--json"],
                                capture_output=True, text=True, timeout=30)
        report = json.loads(result.stdout) if result.returncode == 0 else None
        actual = observed(report) if report else None
        differences = []
        if actual is None:
            differences.append("CLI refusal: " + result.stderr.strip())
        else:
            for key, value in wanted.items():
                equal = (math.isclose(value, actual[key], rel_tol=1e-11, abs_tol=1e-11)
                         if isinstance(value, float) and isinstance(actual[key], int | float)
                         else value == actual[key])
                if not equal:
                    differences.append(key)
            if baseline and wanted["format"] == "presentmon2":
                old = next(c for c in baseline["cases"] if c["file"] == fixture["file"])
                assert report["summary"] == old["summary"], "v2 metric control changed"
        cases.append(dict(file=fixture["file"], exitCode=result.returncode, expected=wanted,
                          observed=actual, differences=differences,
                          summary=report["summary"] if report else None,
                          clockEvidence=report["source"].get("presentClockEvidence") if report else None))
    receipt = dict(cases=cases, total=len(cases), discrepancies=sum(bool(c["differences"]) for c in cases))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({k: receipt[k] for k in ["total", "discrepancies"]}))
    if args.verify and receipt["discrepancies"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
