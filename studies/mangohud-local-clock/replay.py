"""Compare CLI pacing with known record continuity, independent of parser clocks.

The public log is fetched unchanged and hash checked; derived files remove whole
records without changing any cells. They are controlled edits, not user captures.
"""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
URL = "https://raw.githubusercontent.com/Reason7322/mangohudlogs/72a3bfac974b776581e382b3e2bbe2218e40c667/Witchfire-Win64-Shipping_2026-08-12_14-16-42.csv"
SHA256 = "f80aee599f38847c804cc2c06bbac26bf7fa21ac4a29c4813bce02ca1363aba6"


def prepare():
    cache = HERE / "cache"
    cache.mkdir(exist_ok=True)
    public = cache / "witchfire-original.csv"
    if not public.exists():
        with urllib.request.urlopen(URL, timeout=60) as response:
            public.write_bytes(response.read())
    assert hashlib.sha256(public.read_bytes()).hexdigest() == SHA256
    lines = public.read_text().splitlines(keepends=True)
    header = next(i for i, line in enumerate(lines) if line.startswith("fps,frametime,"))
    prefix, records = lines[:header + 1], lines[header + 1:]
    synthetic = ["fps,frametime,cpu_load,elapsed\n"]
    clock = 0
    for ms in [60] * 16 + [120] * 16:
        clock += ms * 1_000_000
        synthetic.append(f"{1000 / ms:.6f},{ms},40,{clock}\n")
    fixture = HERE / "fixtures"
    fixture.mkdir(exist_ok=True)
    (fixture / "complete.csv").write_text("".join(synthetic))
    # Omit six 60 ms records immediately before the switch to 120 ms frames.
    kept = list(range(10)) + list(range(16, 32))
    (fixture / "removed-block.csv").write_text(synthetic[0] + "".join(synthetic[i + 1] for i in kept))
    cases = [
        ("controlled-complete", fixture / "complete.csv", list(range(32)), 1),
        ("controlled-removed-block", fixture / "removed-block.csv", kept, 1),
        ("public-original", public, list(range(len(records))), len(prefix)),
    ]
    for label, omitted in [("public-removed-block", set(range(1000, 1300))),
                           ("public-separated-blocks", {i for start in range(1000, 10000, 1000) for i in range(start, start + 10)})]:
        kept = [i for i in range(len(records)) if i not in omitted]
        path = cache / f"{label}.csv"
        path.write_text("".join(prefix) + "".join(records[i] for i in kept))
        cases.append((label, path, kept, len(prefix)))
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "src/cli/index.ts")
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    cases = []
    for label, path, ordinals, header_lines in prepare():
        raw_lines = path.read_text().splitlines()
        rows = list(csv.DictReader(io.StringIO("\n".join(raw_lines[header_lines - 1:]))))
        values = [float(row["frametime"]) for row in rows]
        assert len(values) == len(ordinals)
        breaks = [i for i in range(1, len(values)) if ordinals[i] != ordinals[i - 1] + 1]
        pairs = [i for i in range(1, len(values)) if ordinals[i] == ordinals[i - 1] + 1]
        expected = {"gaps": len(breaks), "pairs": len(pairs),
                    "masdMs": sum(abs(values[i] - values[i - 1]) for i in pairs) / len(pairs)}
        process = subprocess.run([args.node, str(args.cli.resolve()), "summary", str(path), "--json", "--events"],
                                 capture_output=True, text=True, timeout=60)
        assert process.returncode == 0, process.stderr
        report = json.loads(process.stdout)
        summary = report["summary"]
        continuity = report["analysis"]["continuity"]["gaps"]
        observed = {"gaps": summary["pacingCoverage"]["gapBoundaries"],
                    "pairs": summary["pacingCoverage"]["observedPairs"], "masdMs": summary["masdMs"]}
        differences = [key for key in expected if not math.isclose(expected[key], observed[key], rel_tol=1e-12, abs_tol=1e-12)]
        evidence = report["source"]["timingEvidence"]
        if args.verify:
            assert not differences, (label, differences)
            assert continuity == [{"beforeFrame": i + 1, "sourceLine": header_lines + i + 1} for i in breaks]
            assert summary["frameCount"] == len(values)
            assert math.isclose(summary["durationSec"], sum(values) / 1000, rel_tol=1e-12)
            assert evidence["discontinuousIntervals"] == len(breaks)
            assert evidence["status"] == ("unverified" if breaks else "compatible")
            assert len(evidence["witnesses"]) + evidence["omittedWitnesses"] == len(breaks)
            for w in evidence["witnesses"]:
                previous, current = (rows[w[k] - header_lines - 1] for k in ["fromSourceLine", "toSourceLine"])
                elapsed = float((Decimal(current["elapsed"]) - Decimal(previous["elapsed"])) / 1_000_000)
                assert math.isclose(elapsed, w["elapsedMs"], abs_tol=1e-9)
                assert float(current["frametime"]) == w["frameTimeMs"]
            baseline_path = HERE / "before.json"
            if baseline_path.exists():
                baseline = next(case for case in json.loads(baseline_path.read_text())["cases"] if case["name"] == label)
                for key, value in [("durationSec", summary["durationSec"]), ("averageFps", summary["averageFps"]),
                                   ("hitches", summary["stutter"]["hitchCount"]), ("sourceRecords", len(values))]:
                    assert value == baseline[key], (label, key)
        cases.append({"name": label, "inputSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                      "sourceRecords": len(values), "expected": expected, "observed": observed,
                      "differences": differences, "durationSec": summary["durationSec"],
                      "averageFps": summary["averageFps"], "hitches": summary["stutter"]["hitchCount"],
                      "episodes": len(report["episodes"]), "timingEvidence": evidence,
                      "gaps": continuity})
    output = {"node": subprocess.check_output([args.node, "--version"], text=True).strip(),
              "source": {"url": URL, "sha256": SHA256, "license": "none stated; capture bytes not redistributed"},
              "oracle": "Unchanged source-record ordinals determine contiguous retained pairs; Python calculates MASD only across those pairs.",
              "cases": cases, "discrepancies": sum(bool(case["differences"]) for case in cases)}
    args.out.parent.mkdir(exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"cases": len(cases), "discrepancies": output["discrepancies"]}))


if __name__ == "__main__":
    main()
