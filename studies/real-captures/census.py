"""Parse census: run released (v0.2.5) and checkout CLIs on every cached capture and
compare frame count / duration with an independent count made here (csv module only).

Usage: python3 -I census.py <rel-out-dir> <head-out-dir> > census.json
Both dirs are `tsc -p tsconfig.cli.json --outDir <dir>` builds (see README, Reproduce).
"""
import csv, io, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REL, HEAD = sys.argv[1], sys.argv[2]
FT_COLS = ["MsBetweenPresents", "msBetweenPresents", "FrameTime", "frametime"]


def independent(path):
    """Own reader: frames per (Application, ProcessID, SwapChain) stream, the busiest non-dwm one."""
    text = open(path, "rb").read().decode("utf-8-sig", "replace")
    lines = text.splitlines()
    start = 0
    for i, l in enumerate(lines):          # MangoHud has two preamble sections
        if l.startswith("fps,frametime"):
            start = i
            break
    rows = list(csv.reader(io.StringIO("\n".join(lines[start:]))))
    head = [h.strip() for h in rows[0]]
    col = next((c for c in FT_COLS if c in head), None)
    if col is None:
        return {"error": "no frame-time column among " + ",".join(FT_COLS)}
    ci = head.index(col)
    key = [head.index(k) for k in ("Application", "ProcessID", "SwapChainAddress") if k in head]
    streams, na = {}, 0
    for r in rows[1:]:
        if len(r) <= ci:
            continue
        try:
            v = float(r[ci])
        except ValueError:
            na += 1
            continue
        k = tuple(r[i] for i in key)
        s = streams.setdefault(k, [0, 0.0])
        s[0] += 1
        s[1] += v
    if not streams:
        return {"error": "no numeric frame times", "column": col}
    cand = {k: v for k, v in streams.items() if not (k and k[0].lower() == "dwm.exe")} or streams
    k, (n, ms) = max(cand.items(), key=lambda kv: kv[1][0])
    extra = {}
    if "elapsed" in head:                    # MangoHud: ns since logging started
        ei = head.index("elapsed")
        e = [float(r[ei]) / 1e6 for r in rows[1:] if len(r) > ei]
        steps = sorted(b - a for a, b in zip(e, e[1:]))
        extra = {"elapsedSpanSec": (e[-1] - e[0]) / 1000, "medianElapsedStepMs": steps[len(steps) // 2]}
    return {**extra, "column": col, "streams": len(streams), "stream": list(k), "frames": n, "durationSec": ms / 1000, "nonNumericRows": na}


def run(out, path):
    p = subprocess.run(["env", "-i", "PATH=" + os.environ["PATH"], "HOME=/nonexistent", "node",
                        os.path.join(out, "cli/index.js"), "summary", "--json", path],
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0 or not p.stdout.startswith("{"):
        return {"status": "refused", "message": (p.stderr or p.stdout).strip().replace(path, "<file>")[:400]}
    d = json.loads(p.stdout)
    src = d.get("source", {})   # the released 0.2.5 JSON has no `source` block
    return {"status": "parsed", "format": d["format"], "frames": d["summary"]["frameCount"],
            "durationSec": d["summary"]["durationSec"], "warnings": src.get("warnings"),
            "streams": len(d.get("streams") or []), "summary": d["summary"]}


man = json.load(open(os.path.join(HERE, "manifest.json")))["files"]
out = []
for f in man:
    path = os.path.join(HERE, f["local"])
    if f["path"].endswith("summary.csv") or "Summary" in f["path"]:
        continue
    rec = {"id": f["repo"].split("/")[0] + ":" + f["path"], "repo": f["repo"], "bytes": f["bytes"],
           "independent": independent(path), "released": run(REL, path), "checkout": run(HEAD, path)}
    out.append(rec)
    print(rec["id"], rec["released"]["status"], rec["checkout"]["status"], file=sys.stderr)
json.dump(out, sys.stdout, indent=1)
