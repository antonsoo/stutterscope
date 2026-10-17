"""Compare unchanged pinned public captures with two actual CLI entrypoints.

Run studies/real-captures/fetch.py first to populate its ignored capture cache.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--before-cli", type=Path, required=True)
parser.add_argument("--after-cli", type=Path, default=ROOT / "src/cli/index.ts")
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((ROOT / "studies/real-captures/manifest.json").read_text())["files"]
results = []
for entry in manifest:
    if entry["path"].endswith("summary.csv") or "Summary" in entry["path"]:
        continue
    path = ROOT / "studies/real-captures" / entry["local"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
    outputs = []
    for cli in (args.before_cli, args.after_cli):
        process = subprocess.run(["node", str(cli.resolve()), "summary", str(path), "--json", "--events"],
                                 capture_output=True, text=True, timeout=60)
        outputs.append((process.returncode, json.loads(process.stdout) if process.returncode == 0 else process.stderr))
    before, after = outputs
    assert before[0] == after[0], entry["path"]
    if before[0] == 0:
        for field in ("summary", "episodes", "analysis"):
            assert before[1][field] == after[1][field], (entry["path"], field)
        status = "all metrics, episodes, and analysis unchanged"
    else:
        assert before[1] == after[1], entry["path"]
        status = "same refusal"
    results.append({"repo": entry["repo"], "path": entry["path"], "sha256": entry["sha256"], "result": status})
args.out.write_text(json.dumps({"controls": results, "unchanged": len(results)}, indent=2) + "\n")
print(json.dumps({"controls": len(results), "unchanged": len(results)}))
