"""Retain native PresentMon controls and the documented exclude_dropped transform.

python3 studies/present-clock/generate.py [--fetch]
The existing pinned corpus cache is used by default. --fetch permits downloading
missing public fixtures. No game is run and no telemetry is synthesized as native.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from decimal import Decimal
from pathlib import Path
import urllib.request

HERE = Path(__file__).resolve().parent
CORPUS = HERE.parent / "real-captures"


def digest(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def expectation(records):
    groups = {}
    for line, row, ordinal in records:
        key = (row["ProcessID"], row["SwapChainAddress"])
        groups.setdefault(key, []).append((line, row, ordinal))
    ordered = sorted(groups.values(), key=len, reverse=True)
    selected = next((rows for rows in ordered if rows[0][1]["Application"].lower() != "dwm.exe"), ordered[0])
    times = [float(row["msBetweenPresents"]) for _, row, _ in selected]
    # Oracle: native per-stream ordinal adjacency BEFORE filtering. No clock
    # threshold or production gap-detector implementation supplies this truth.
    pairs = [abs(times[i] - times[i-1]) for i in range(1, len(times)) if selected[i][2] == selected[i-1][2] + 1]
    gaps = [dict(beforeFrame=i+1, sourceLine=selected[i][0]) for i in range(1, len(times)) if selected[i][2] != selected[i-1][2] + 1]
    return dict(frames=len(times), averageFps=len(times) * 1000 / sum(times),
        gaps=gaps, observedPairs=len(pairs), masdMs=sum(pairs)/len(pairs) if pairs else None,
        stream=":".join((selected[0][1]["ProcessID"], selected[0][1]["SwapChainAddress"])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    cases = []
    sources = []
    for source in json.loads((CORPUS / "manifest.json").read_text())["files"]:
        if not source["path"].endswith("_v1.csv"):
            continue
        cached = CORPUS / source["local"]
        if not cached.exists() and args.fetch:
            with urllib.request.urlopen(source["url"], timeout=30) as response:
                data = response.read()
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(data)
        data = cached.read_bytes()
        assert digest(data) == {key: source[key] for key in ["bytes", "sha256"]}
        lines = data.decode("utf-8-sig").splitlines(keepends=True)
        rows = list(csv.DictReader(io.StringIO("".join(lines))))
        assert len(rows) == len(lines) - 1
        sources.append({key: source[key] for key in ["url", "commit", "licence", "bytes", "sha256"]})
        for filtered in [False, True]:
            name = Path(source["path"]).stem + ("-exclude-dropped" if filtered else "-original")
            output = [lines[0]]
            records = []
            ordinals = {}
            for row, line in zip(rows, lines[1:]):
                key = (row["ProcessID"], row["SwapChainAddress"])
                ordinal = ordinals.get(key, 0)
                ordinals[key] = ordinal + 1
                if filtered and row["Dropped"] == "1":
                    continue
                output.append(line)
                records.append((len(output), row, ordinal))
            # Keep each native row's text and line ending, including full precision.
            captured = (b"\xef\xbb\xbf" if data.startswith(b"\xef\xbb\xbf") else b"") + "".join(output).encode()
            file = "fixtures/" + name + ".csv"
            (HERE / file).write_bytes(captured)
            cases.append(dict(name=name, file=file, options=[], provenance="Native Intel gold capture" + ("; removed Dropped=1 rows" if filtered else "; unfiltered control"),
                source=source["url"], input=digest(captured), expected=expectation(records), unchanged=not filtered))

    def save(name, text, options, expected, file_name=None):
        data = text.encode()
        file = "fixtures/" + (file_name or name) + ".csv"
        (HERE / file).write_bytes(data)
        cases.append(dict(name=name, file=file, options=options, provenance="Constructed compatibility/control sequence; not a game benchmark", input=digest(data), expected=expected))

    for fmt in ["presentmon1", "ocat", "capframex", "frameview"]:
        ft = "msBetweenPresents" if fmt == "presentmon1" else "MsBetweenPresents"
        extra = ",msInPresentAPI" if fmt == "presentmon1" else ",GPU0Util(%)" if fmt == "frameview" else ""
        prefix = "//GameName=Controlled\n" if fmt == "capframex" else ""
        header = prefix + f"Application,ProcessID,SwapChainAddress,TimeInSeconds,{ft}{extra}\n"
        rows = [f"game.exe,42,0x1,1.000000,60.0000{',1' if extra else ''}\n", f"game.exe,42,0x1,1.200000,120.0000{',1' if extra else ''}\n"]
        save(fmt + "-hitches", header + "".join(rows), ["--format", fmt], dict(frames=2, gaps=[dict(beforeFrame=2, sourceLine=4 if prefix else 3)], observedPairs=0, masdMs=None, episodes=2, hitches=2))
    header = "Application,ProcessID,SwapChainAddress,TimeInSeconds,msBetweenPresents,msInPresentAPI\n"
    save("coarse-clock", header + "".join(f"game.exe,42,0x1,{t},16.7000,1\n" for t in ["0.00", "0.02", "0.03"]), [],
        dict(frames=3, gaps=[], observedPairs=2, masdMs=0))
    save("reversed-clock", header + "game.exe,42,0x1,1.000000,60.0000,1\ngame.exe,42,0x1,0.000000,120.0000,1\n", [],
        dict(frames=2, gaps=[dict(beforeFrame=2, sourceLine=3)], observedPairs=0, masdMs=None, episodes=2, hitches=2))
    mixed = header + "game.exe,42,0x1,1.000000,10.0000,1\noverlay.exe,43,0x2,0.500000,10.0000,1\ngame.exe,42,0x1,1.010000,10.0000,1\noverlay.exe,43,0x2,0.520000,10.0000,1\ngame.exe,42,0x1,1.020000,10.0000,1\n"
    save("interleaved-game", mixed, [], dict(frames=3, gaps=[], observedPairs=2, masdMs=0))
    save("interleaved-overlay", mixed, ["--stream", "overlay.exe"], dict(frames=2, gaps=[dict(beforeFrame=2, sourceLine=5)], observedPairs=0, masdMs=None), file_name="interleaved-game")
    # A discontinuity found in an untouched public FrameView capture. Retain
    # five original rows and their header, rather than redistributing 57 MB.
    source = next(s for s in json.loads((CORPUS / "manifest.json").read_text())["files"] if s["path"] == "examples/frameview-1-6.csv")
    cached = CORPUS / source["local"]
    if not cached.exists() and args.fetch:
        with urllib.request.urlopen(source["url"], timeout=90) as response:
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(response.read())
    original = cached.read_bytes()
    assert digest(original) == {key: source[key] for key in ["bytes", "sha256"]}
    lines = original.decode("utf-8-sig").splitlines(keepends=True)
    excerpt = lines[:1] + lines[49058:49063]
    rows = list(csv.DictReader(io.StringIO("".join(excerpt))))
    assert len(rows) == 5
    elapsed = (Decimal(rows[2]["TimeInSeconds"]) - Decimal(rows[1]["TimeInSeconds"])) * 1000
    assert elapsed == Decimal("9.249000") and Decimal(rows[2]["MsBetweenPresents"]) == Decimal("4.439")
    ft = [Decimal(row["MsBetweenPresents"]) for row in rows]
    masd = sum(abs(ft[i]-ft[i-1]) for i in [1, 3, 4]) / 3
    save("frameview-native-excerpt", "".join(excerpt), [], dict(frames=5, gaps=[dict(beforeFrame=3, sourceLine=4)], observedPairs=3, masdMs=float(masd)))
    cases[-1].update(provenance="Five unchanged per-frame rows from a public Resident Evil 4 FrameView 1.6 example; no cause of the discontinuity inferred.",
        source=source["url"], originalPhysicalLines=[49059, 49060, 49061, 49062, 49063],
        clockEvidence=dict(elapsedMs=str(elapsed), recordedFrameMs="4.439", expectedGapBeforeFrame=3))
    sources.append({key: source[key] for key in ["url", "commit", "licence", "bytes", "sha256"]})
    example = HERE.parent.parent / "examples/native-filtering"
    example.mkdir(exist_ok=True)
    example.joinpath("filtered-presents.csv").write_bytes((HERE / "fixtures/test_case_5_v1-exclude-dropped.csv").read_bytes())
    example.joinpath("LICENSE.txt").write_bytes((HERE / "UPSTREAM-LICENSE.txt").read_bytes())
    (HERE / "cases.json").write_text(json.dumps(dict(baseline="8728c17f2fae45774c1b1597c0b2ab66413d42be", oracle="Per-stream native record ordinals before filtering, independent of clock arithmetic. Constructed controls have explicit source boundaries.",
        sources=sources, cases=cases), indent=2) + "\n")
    print(json.dumps(dict(cases=len(cases), nativeSources=len(sources))))


if __name__ == "__main__":
    main()
