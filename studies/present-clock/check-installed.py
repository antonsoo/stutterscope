"""Verify the packed CLI on Node 22.6.0 and Node 24, including its real bin."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--consumer", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path, action="append")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    source = json.loads((HERE / "results/after.json").read_text())
    bin_path = args.consumer / "node_modules/.bin/stutterscope"
    cli = args.consumer / "node_modules/@antonsoloviev/stutterscope/dist-cli/cli/index.js"
    receipts = []
    for index, node in enumerate(args.node):
        env = {**os.environ, "PATH": str(node.parent) + os.pathsep + os.environ["PATH"]}
        version = subprocess.check_output([str(node), "--version"], text=True).strip()
        replay = args.out / f"installed-{index}.json"
        subprocess.run([sys.executable, str(HERE / "replay.py"), "--cli", str(cli), "--node", str(node), "--out", str(replay), "--verify"], check=True, env=env)
        value = json.loads(replay.read_text())
        assert value["cases"] == source["cases"]
        assert "0.2.5" in subprocess.check_output([str(bin_path), "--version"], text=True, env=env)
        reports = []
        for name in ["test_case_5_v1-exclude-dropped", "frameview-native-excerpt"]:
            case = next(c for c in json.loads((HERE / "cases.json").read_text())["cases"] if c["name"] == name)
            result = subprocess.run([str(bin_path), "summary", str(HERE / case["file"]), "--json", "--events"], capture_output=True, text=True, check=True, env=env)
            actual = json.loads(result.stdout)
            actual["file"] = Path(case["file"]).name
            assert actual == next(c for c in source["cases"] if c["name"] == name)["report"]
            (args.out / f"bin-{index}-{name}.json").write_text(result.stdout)
            reports.append(dict(name=name, exitCode=result.returncode, stdoutSha256=hashlib.sha256(result.stdout.encode()).hexdigest(), completeReportMatches=True))
        receipts.append(dict(node=version, realBinWorks=True, replayCases=len(value["cases"]), reports=reports,
            normalization="Only the top-level CLI file argument is replaced with its basename for report comparisons; original stdout is retained in scratch."))
    (args.out / "installed-cli-checks.json").write_text(json.dumps(receipts, indent=2) + "\n")
    print(json.dumps(receipts))


if __name__ == "__main__":
    main()
