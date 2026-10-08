"""Combine census.json and the definitions output into results.json.

Usage: python3 -I make_results.py <census.json> <definitions.json> > results.json
"""
import json, sys
census = json.load(open(sys.argv[1]))
defs = json.load(open(sys.argv[2]))
rows = []
tally = {"released": {}, "checkout": {}}
for c in census:
    ind = c["independent"]
    row = {"id": c["id"], "bytes": c["bytes"], "independent": ind}
    for v in ("released", "checkout"):
        r = c[v]
        if r["status"] == "parsed":
            row[v] = {"status": "parsed", "format": r["format"], "frames": r["frames"], "durationSec": r["durationSec"],
                      "warnings": len(r.get("warnings") or []),
                      "frameCountMatchesIndependent": r["frames"] == ind.get("frames"),
                      "durationMatchesIndependent": abs(r["durationSec"] - ind.get("durationSec", -1)) < 1e-6}
        else:
            row[v] = {"status": "refused", "message": r["message"]}
        k = row[v]["status"] + (":" + row[v]["format"] if row[v]["status"] == "parsed" else "")
        tally[v][k] = tally[v].get(k, 0) + 1
    rows.append(row)
out = {"files": len(rows), "tally": tally, "census": rows, "definitions": defs}
json.dump(out, sys.stdout, indent=1)
