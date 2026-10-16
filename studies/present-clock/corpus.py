"""Compare retained input evidence and distributions across the pinned corpus."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
CORPUS = HERE.parent / "real-captures"


def run(cli, path):
    result = subprocess.run(["node", str(cli), "summary", str(path), "--json", "--events"], capture_output=True, text=True, timeout=90)
    if result.returncode:
        return dict(status="refused", exitCode=result.returncode, error=result.stderr.strip().replace(str(path), "<capture>"))
    report = json.loads(result.stdout)
    report.pop("file", None)
    return dict(status="parsed", report=report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    cases = []
    for source in json.loads((CORPUS / "manifest.json").read_text())["files"]:
        if not source["path"].lower().endswith(".csv") or "summary" in source["path"].lower():
            continue
        path = CORPUS / source["local"]
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == source["sha256"] and len(data) == source["bytes"]
        before, after = run(args.before, path), run(args.after, path)
        assert before["status"] == after["status"], source["path"]
        value = dict(url=source["url"], sha256=source["sha256"], status=after["status"])
        if after["status"] == "parsed":
            a, b = before["report"], after["report"]
            changed = [key for key in a["summary"] if a["summary"][key] != b["summary"][key]]
            assert set(changed) <= {"masdMs", "pacingCoverage", "stutter"}, (source["path"], changed)
            source_before, source_after = dict(a["source"]), dict(b["source"])
            source_after.pop("presentClockGaps", None)
            source_after.pop("presentClockEvidence", None)
            assert source_before == source_after
            value.update(frames=b["summary"]["frameCount"], clockGaps=b["source"].get("presentClockGaps", 0), changedMetrics=changed, fullReportUnchanged=a == b)
            if a != b:
                value.update(before=before, after=after)
        else:
            assert before == after
            value["refusal"] = after
        cases.append(value)
    args.out.write_text(json.dumps(dict(scope="Byte-verified cached public captures; not newly recorded games or a completeness/accuracy benchmark.", cases=cases), indent=2) + "\n")
    print(json.dumps(dict(captures=len(cases), parsed=sum(c["status"] == "parsed" for c in cases), changed=sum(bool(c.get("changedMetrics")) for c in cases))))


if __name__ == "__main__":
    main()
