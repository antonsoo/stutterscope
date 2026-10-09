"""Replay pinned captures and controlled missing telemetry against a Python CSV oracle.

No performance or prevalence claim is inferred from the constructed controls.
Use --observe-only for the old checkout. Source may be src/ or installed dist-cli/.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import random
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REAL = HERE.parent / "real-captures"


def number(value):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (ValueError, TypeError):
        return None


def positive(value):
    parsed = number(value)
    return parsed if parsed is not None and parsed >= 0 else None


def oracle(text, format_name, selected_stream):
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    header = reader.fieldnames
    frame_column = "FrameTime" if format_name == "presentmon2" else "MsBetweenPresents"
    if format_name == "presentmon1":
        frame_column = "msBetweenPresents"
    rows = []
    for row in reader:
        if positive(row.get(frame_column)) is None:
            continue
        stream = f"{row.get('ProcessID', '')}:{row.get('SwapChainAddress', '')}"
        if selected_stream and stream != selected_stream:
            continue
        rows.append(row)
    n = len(rows)
    display = format_name == "presentmon2"
    flag_column = "DisplayedTime" if display else "Dropped"
    flags = []
    for row in rows:
        raw = row.get(flag_column)
        if display:
            flag = (
                1
                if raw is not None and raw.strip() == "NA"
                else (0 if positive(raw) is not None else None)
            )
        else:
            flag = number(raw)
            if flag not in (0, 1):
                flag = None
        if flag is not None:
            flags.append(flag)
    busy = [
        (positive(row.get("CPUBusy")), positive(row.get("GPUBusy"))) for row in rows
    ]
    busy = [(c, g) for c, g in busy if c is not None and g is not None]
    latency_column = (
        "DisplayLatency"
        if display
        else "MsPCLatency"
        if format_name == "frameview"
        else None
    )
    latencies = sorted(
        v for row in rows if (v := positive(row.get(latency_column))) is not None
    )

    def coverage(present, count):
        return (
            {"observedFrames": count, "unknownFrames": n - count} if present else None
        )

    def percentile(p):
        index = (len(latencies) - 1) * p
        lower = math.floor(index)
        return latencies[lower] + (latencies[math.ceil(index)] - latencies[lower]) * (
            index - lower
        )

    return {
        "frameCount": n,
        "droppedCount": int(sum(flags)) if flags else None,
        "droppedFraction": sum(flags) / len(flags) if flags else None,
        "gpuBoundFraction": sum(g > c for c, g in busy) / len(busy) if busy else None,
        "latencyP99": percentile(0.99) if latencies else None,
        "telemetryCoverage": {
            "dropped": coverage(flag_column in header, len(flags)),
            "cpuGpuBusy": coverage(
                "CPUBusy" in header and "GPUBusy" in header, len(busy)
            ),
            "displayLatency": coverage(latency_column in header, len(latencies)),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--observe-only", action="store_true")
    parser.add_argument(
        "--node",
        default="node",
        help="Node executable; older runtimes need compiled dist-cli",
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((REAL / "manifest.json").read_text())
    jobs, provenance = [], {}
    for entry in manifest["files"]:
        if entry["repo"] != "GameTechDev/PresentMon" and not entry["path"].endswith(
            "frameview-1-6.csv"
        ):
            continue
        path = REAL / entry["local"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == entry["sha256"], f"capture hash changed: {path}"
        ident = entry["repo"] + "/" + entry["path"]
        jobs.append({"id": ident, "path": str(path)})
        provenance[ident] = {
            "kind": "pinned capture",
            "url": entry["url"],
            "sha256": digest,
        }

    rng = random.Random(20261009)
    for index in range(180):
        format_name = [
            "presentmon1",
            "presentmon2",
            "frameview",
            "ocat",
            "capframex",
            "generic",
        ][index % 6]
        v2 = format_name == "presentmon2"
        frame = (
            "FrameTime"
            if v2
            else "msBetweenPresents"
            if format_name == "presentmon1"
            else "MsBetweenPresents"
        )
        flag = "DisplayedTime" if v2 else "Dropped"
        header = ["Application", "ProcessID", "SwapChainAddress", frame, flag]
        if v2:
            header += ["CPUBusy", "GPUBusy", "DisplayLatency"]
        elif format_name == "frameview":
            header += ["MsPCLatency"]
        # Some controls omit the column entirely; others retain only unknown outcomes.
        absent = index % 11 == 0
        unknown = index % 13 == 0
        if absent:
            header.remove(flag)
        output = io.StringIO()
        writer = csv.DictWriter(output, header)
        writer.writeheader()
        for _ in range(64):
            row = {
                "Application": "game",
                "ProcessID": "1",
                "SwapChainAddress": "0x1",
                frame: rng.choice([0, 16, 16.7, 22, 120]),
            }
            if not absent:
                row[flag] = rng.choice(
                    ["", "broken", "N/A"]
                    if unknown
                    else (
                        [0, 16, "NA", "", "broken", -2]
                        if v2
                        else [0, 1, "", "NA", "broken", 2]
                    )
                )
            for column in header[4:]:
                if column != flag:
                    row[column] = rng.choice([0, 2, 10, 30, "NA", "", -1])
            writer.writerow(row)
        content = output.getvalue()
        ident = f"controlled-{index:03}-{format_name}"
        path = args.out / f"{ident}.csv"
        path.write_text(content)
        jobs.append(
            {
                "id": ident,
                "path": str(path),
                "format": format_name,
                "mapping": {
                    "valueColumn": frame,
                    "valueKind": "frametime_ms",
                    "droppedColumn": "Dropped",
                },
            }
        )
        provenance[ident] = {
            "kind": "controlled missing/invalid telemetry",
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    jobs_file = args.out / "jobs.json"
    jobs_file.write_text(json.dumps(jobs))
    observed = args.out / "observed.json"
    subprocess.run(
        [
            args.node,
            str(HERE / "replay.mjs"),
            str(args.src.resolve()),
            str(jobs_file),
            str(observed),
        ],
        check=True,
    )
    replay = json.loads(observed.read_text())
    results = []
    for job, actual in zip(jobs, replay["results"], strict=True):
        assert job["id"] == actual["id"]
        content = Path(job["path"]).read_text(encoding="utf-8-sig")
        expected = oracle(content, actual["format"], actual.get("selectedStream"))
        summary = actual["summary"]
        actual_values = {
            "frameCount": summary["frameCount"],
            "droppedCount": (summary["dropped"] or {}).get("droppedCount"),
            "droppedFraction": (summary["dropped"] or {}).get("droppedFraction"),
            "gpuBoundFraction": (summary["boundShare"] or {}).get("gpuBoundFraction"),
            "latencyP99": (summary["latency"] or {}).get("p99"),
        }
        disagreements = []
        for key, value in actual_values.items():
            target = expected[key]
            if value != target and not (
                isinstance(value, (int, float))
                and isinstance(target, (int, float))
                and math.isclose(value, target, abs_tol=1e-9)
            ):
                disagreements.append(key)
        if (
            "telemetryCoverage" in summary
            and summary["telemetryCoverage"] != expected["telemetryCoverage"]
        ):
            disagreements.append("telemetryCoverage")
        results.append(
            {
                "id": job["id"],
                **provenance[job["id"]],
                "expected": expected,
                "actual": actual_values,
                "coverage": summary.get("telemetryCoverage"),
                "disagreements": disagreements,
                "milliseconds": actual["milliseconds"],
            }
        )
    result = {
        "scope": "Pinned public captures plus deliberate damage controls; not a prevalence estimate",
        "node": replay["node"],
        "results": results,
    }
    (args.out / "results.json").write_text(json.dumps(result, indent=2) + "\n")
    failed = [r["id"] for r in results if r["disagreements"]]
    print(
        json.dumps(
            {
                "cases": len(results),
                "disagreeingCases": len(failed),
                "first": failed[:5],
            }
        )
    )
    if failed and not args.observe_only:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
