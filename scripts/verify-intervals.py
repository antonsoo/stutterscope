"""Independent NumPy/statistics checks of the retained controlled capture.

Build the CLI, then run: uv run --with numpy --no-project python scripts/verify-intervals.py
This reads the CSV directly; it does not import Stutterscope's core algorithms.
"""

import csv
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
outcomes = []
for name in ("a", "b"):
    path = ROOT / "examples" / "controlled-browser" / f"controlled-{name}.csv"
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    full = np.array([float(row["frame_time_ms"]) for row in rows])
    # Decimal capture timestamps are independently logged by the workload.
    ends = np.array([float(row["elapsed_ms"]) / 1000 for row in rows])
    np.testing.assert_allclose(np.cumsum(full) / 1000, ends, rtol=0, atol=2e-10)
    full_flags = np.array([
        value > 2 * statistics.median(full[max(0, index - 10): index + 11])
        for index, value in enumerate(full)
    ])
    for start, end in ((0, None), (1.5, 8.5), (2.2, 2.34)):
        command = ["node", str(ROOT / "dist-cli" / "cli" / "index.js"), "summary", str(path), "--events", "--json"]
        if start or end is not None:
            command += ["--start", str(start)]
            if end is not None:
                command += ["--end", str(end)]
        report = json.loads(subprocess.check_output(command, text=True))
        mask = (ends > start) & (ends <= (end if end is not None else math.inf))
        selected = full[mask]
        flags = full_flags[mask]
        summary = report["summary"]
        expected = {
            "frameCount": len(selected),
            "durationSec": float(np.sum(selected) / 1000),
            "averageFps": float(len(selected) * 1000 / np.sum(selected)),
            "masdMs": float(np.mean(np.abs(np.diff(selected)))) if len(selected) > 1 else 0,
        }
        for key, value in expected.items():
            np.testing.assert_allclose(summary[key], value, rtol=1e-11, atol=1e-11, err_msg=f"{name}/{start}/{end}: {key}")
        for key, percentile in (("p50", 50), ("p90", 90), ("p95", 95), ("p99", 99), ("p999", 99.9)):
            np.testing.assert_allclose(summary["percentilesMs"][key], np.percentile(selected, percentile), rtol=1e-11, atol=1e-11)
        for key, fraction in (("onePercentLow", 0.01), ("pointOnePercentLow", 0.001)):
            count = max(1, math.floor(len(selected) * fraction + 0.5))
            np.testing.assert_allclose(summary[key]["meanOfSlowestMethodFps"], 1000 / np.mean(np.sort(selected)[-count:]), rtol=1e-11)
            np.testing.assert_allclose(summary[key]["percentileMethodFps"], 1000 / np.percentile(selected, 100 * (1 - fraction)), rtol=1e-11)
        assert summary["stutter"]["stutterFrameIndices"] == np.flatnonzero(flags).tolist()
        assert summary["stutter"]["hitchCount"] == np.count_nonzero(selected > 50)
        np.testing.assert_allclose(summary["stutter"]["totalStutterTimeMs"], np.sum(selected[flags]), rtol=1e-11)
        original_indices = np.flatnonzero(mask)
        assert report["analysis"]["selection"]["firstFrameIndex"] == original_indices[0]
        for episode in report["episodes"]:
            assert episode["firstSourceLine"] == episode["firstFrame"] + 1
            assert episode["lastSourceLine"] == episode["lastFrame"] + 1
            values = full[episode["firstFrame"] - 1:episode["lastFrame"]]
            assert len(values) == episode["frameCount"]
            np.testing.assert_allclose(np.max(values), episode["longestFrameMs"], rtol=1e-11)
        outcomes.append({"capture": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "startSec": start, "endSec": end, **expected,
                         "p99Ms": summary["percentilesMs"]["p99"], "onePercentLowPercentileFps": summary["onePercentLow"]["percentileMethodFps"],
                         "onePercentLowSlowestMeanFps": summary["onePercentLow"]["meanOfSlowestMethodFps"], "stutterFrames": int(np.count_nonzero(flags)),
                         "hitchFrames": int(np.count_nonzero(selected > 50)), "episodeSourceLines": [episode["firstSourceLine"] for episode in report["episodes"]]})
print(json.dumps({"python": sys.version.split()[0], "numpy": np.__version__, "checks": outcomes}, indent=2))
