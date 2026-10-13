"""Exercise a built or installed CLI; all paths in retained results are portable.

python3 -I replay.py /path/to/dist-cli/cli/index.js --label baseline > results/before.json
Add --corpus to replay the hash-checked cache in ../real-captures instead.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cli", type=Path)
    ap.add_argument("--node", default="node")
    ap.add_argument("--label", required=True)
    ap.add_argument("--corpus", action="store_true")
    args = ap.parse_args()
    cli = args.cli.resolve()
    if args.corpus:
        base = HERE.parent / "real-captures"
        cases = []
        for f in json.loads((base / "manifest.json").read_text())["files"]:
            if "summary" in f["path"].lower():
                continue
            cases.append({"id": f'{f["repo"]}:{f["path"]}', "file": f["local"], "sha256": f["sha256"]})
    else:
        base = HERE
        cases = json.loads((HERE / "cases.json").read_text())
    results = []
    for case in cases:
        file = base / case["file"]
        sha = digest(file.read_bytes())
        if "sha256" in case:
            assert sha == case["sha256"], file
        command = [args.node, str(cli), "summary", str(file), "--json", *case.get("options", [])]
        run = subprocess.run(command, capture_output=True, text=True, timeout=60,
                             env={**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"})
        stderr = run.stderr.replace(str(file), "<capture>").strip()
        record = {"id": case["id"], "inputSha256": sha, "exit": run.returncode, "stderr": stderr}
        if run.returncode == 0:
            report = json.loads(run.stdout)
            summary = report["summary"]
            record.update(status="parsed", format=report["format"], frames=summary["frameCount"],
                          averageFps=summary["averageFps"], durationSec=summary["durationSec"],
                          hitchCount=summary["stutter"]["hitchCount"],
                          summarySha256=digest(json.dumps(summary, sort_keys=True).encode()),
                          warnings=report.get("source", {}).get("warnings"))
            source = report.get("source", {})
            record.update(application=source.get("application"), streams=source.get("streams"),
                          skippedRows=source.get("skippedRows"))
            portable = {**report, "file": "<capture>"}
            record["reportSha256"] = digest(json.dumps(portable, sort_keys=True).encode())
        else:
            record.update(status="rejected", stdout=run.stdout)
        if "expected" in case:
            ok = record["status"] == case["expected"]
            if case["expected"] == "rejected":
                ok = ok and run.returncode == 1 and run.stdout == "" and "Invalid UTF-" in stderr
            if case.get("frames") and run.returncode == 0:
                ok = ok and record["frames"] == case["frames"] and math.isclose(record["averageFps"], case["averageFps"], rel_tol=1e-12)
                ok = ok and len(record["streams"]) == case["streams"] and record["application"] == case["application"]
            record.update(expected=case["expected"], agrees=ok)
        results.append(record)
    code = cli.parent.parent
    # Covers every shipped JS module, not just the unchanged CLI entry point.
    tree = {str(p.relative_to(code)): digest(p.read_bytes()) for p in sorted(code.rglob("*.js"))}
    output = {"label": args.label, "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
              "compiledTreeSha256": digest(json.dumps(tree, sort_keys=True).encode()),
              "count": len(results), "results": results}
    if not args.corpus:
        output["disagreements"] = sum(not r["agrees"] for r in results)
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
