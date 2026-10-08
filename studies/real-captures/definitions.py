"""Seven "1% low" / "0.1% low" definitions, each written from the tool source cited in README.md,
applied to the busiest non-dwm stream of every real per-frame capture with >= MIN_FRAMES frames.
Also reads the two tool-written summaries (MangoHud _summary.csv, FrameView summary) for comparison.

Usage: python3 -I definitions.py <census.json> > results.json
"""
import csv, io, json, math, os, statistics, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
MIN_FRAMES = 900
# No summary row matches it and it holds a 7.8 s frame the other two copies lack; provenance unverifiable.
EXCLUDE = {"Pavelioso:assets/witcher_3_test.csv"}
CAND = ["MsBetweenPresents", "msBetweenPresents", "FrameTime", "frametime"]


def f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


def frame_times(path, stream):
    text = open(path, "rb").read().decode("utf-8-sig", "replace")
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith("fps,frametime")), 0)
    rows = list(csv.reader(io.StringIO("\n".join(lines[start:]))))
    head = [h.strip() for h in rows[0]]
    ci = head.index(next(c for c in CAND if c in head))
    key = [head.index(k) for k in ("Application", "ProcessID", "SwapChainAddress") if k in head]
    out = []
    for r in rows[1:]:
        if len(r) > ci and (not key or [r[i] for i in key] == stream):
            try:
                out.append(float(r[ci]))
            except ValueError:
                pass
    return out


def r7(sorted_asc, p):                      # numpy default, stutterscope metrics.ts percentileOfSorted
    i = p / 100 * (len(sorted_asc) - 1)
    lo, hi = math.floor(i), math.ceil(i)
    return sorted_asc[lo] + (sorted_asc[hi] - sorted_asc[lo]) * (i - lo)


def r8(sorted_asc, tau):                    # MathNet ArrayStatistics.QuantileInplace (R8)
    n = len(sorted_asc)
    h = (n + 1 / 3) * tau + 1 / 3
    hf = int(h)
    if hf <= 0 or tau == 0:
        return sorted_asc[0]
    if hf >= n or tau == 1:
        return sorted_asc[-1]
    a, b = sorted_asc[hf - 1], sorted_asc[hf]
    return a + (h - hf) * (b - a)


def definitions(ft, frac):
    n = len(ft)
    asc = sorted(ft)
    desc = asc[::-1]
    out = {}
    out["stutterscope_percentile"] = 1000 / r7(asc, 100 * (1 - frac))
    k = max(1, math.ceil(n * frac - 1e-9))      # checkout; v0.2.5 used max(1, Math.round(n * frac))
    out["stutterscope_slowest_mean"] = 1000 / (sum(asc[-k:]) / k)
    k = max(1, math.floor(n * frac + 0.5))
    out["released_slowest_mean_round"] = 1000 / (sum(asc[-k:]) / k)
    d32 = sorted((f32(x) for x in ft), reverse=True)           # MangoHud works on float32
    idx = int(frac * n - 1)                                     # fps_metrics.h:82 (uint64 conversion)
    out["mangohud_summary"] = f32(1000.0) / d32[idx]
    out["mangoplot_index"] = 1000 / desc[int(n * frac)]         # mangoplot.py:357-358, ascending fps
    out["capframex_percentile_r8"] = 1000 / r8(asc, 1 - frac)   # fps quantile `frac` == frame-time quantile 1-frac
    q = r8(asc, 1 - frac)
    sel = [x for x in ft if x >= q]
    out["capframex_low_average"] = 1000 / (sum(sel) / len(sel))
    total, cum, i = sum(desc), 0.0, 0                           # GetPercentageHighIntegralSequence
    for i, x in enumerate(desc):
        cum += x
        if cum >= total * frac:
            break
    out["capframex_low_integral"] = 1000 / desc[i]
    out["stutterscope_time_weighted"] = out["capframex_low_integral"]
    return out


SPREAD_KEYS = ["stutterscope_percentile", "stutterscope_slowest_mean", "stutterscope_time_weighted",
               "mangohud_summary", "mangoplot_index", "capframex_percentile_r8", "capframex_low_average"]


PCT_FAMILY = ["stutterscope_percentile", "mangohud_summary", "mangoplot_index", "capframex_percentile_r8"]


def spread(vals):
    v = [vals[k] for k in SPREAD_KEYS]
    return 100 * (max(v) / min(v) - 1)


census = json.load(open(sys.argv[1]))
caps = []
for c in census:
    ind, chk = c["independent"], c["checkout"]
    if ind.get("frames", 0) < MIN_FRAMES or chk["status"] != "parsed" or c["id"] in EXCLUDE:
        continue
    local = [f for f in json.load(open(os.path.join(HERE, "manifest.json")))["files"]
             if f["repo"] + ":" + f["path"] == c["id"].replace(c["id"].split(":")[0], c["repo"].split("/")[0], 1)
             or (f["repo"].split("/")[0] + ":" + f["path"]) == c["id"]][0]
    path = os.path.join(HERE, local["local"])
    ft = frame_times(path, ind["stream"])
    assert len(ft) == ind["frames"], c["id"]
    rec = {"id": c["id"], "frames": len(ft), "durationSec": sum(ft) / 1000, "averageFps": len(ft) * 1000 / sum(ft),
           "meanOfInstantaneousFps": sum(1000 / x for x in ft) / len(ft)}
    for name, frac in (("p1", 0.01), ("p01", 0.001)):
        d = definitions(ft, frac)
        rec[name] = {"values": d, "spreadPct": spread(d)}
    s = chk["summary"]
    rel = c["released"]["summary"]
    rec["stutterscope_reported"] = {"p1_percentile": s["onePercentLow"]["percentileMethodFps"],
                                    "p1_slowest_mean": s["onePercentLow"]["meanOfSlowestMethodFps"],
                                    "p01_percentile": s["pointOnePercentLow"]["percentileMethodFps"],
                                    "p01_slowest_mean": s["pointOnePercentLow"]["meanOfSlowestMethodFps"],
                                    "p1_time_weighted": s["onePercentLow"]["timeWeightedFps"],
                                    "p01_time_weighted": s["pointOnePercentLow"]["timeWeightedFps"],
                                    "averageFps": s["averageFps"]}
    rec["released_reported"] = {"p1_slowest_mean": rel["onePercentLow"]["meanOfSlowestMethodFps"],
                                "p01_slowest_mean": rel["pointOnePercentLow"]["meanOfSlowestMethodFps"],
                                "p1_percentile": rel["onePercentLow"]["percentileMethodFps"],
                                "p01_percentile": rel["pointOnePercentLow"]["percentileMethodFps"]}
    ck = rec["stutterscope_reported"]
    for a, b in ((ck["p1_percentile"], rec["p1"]["values"]["stutterscope_percentile"]),
                 (ck["p1_slowest_mean"], rec["p1"]["values"]["stutterscope_slowest_mean"]),
                 (ck["p1_time_weighted"], rec["p1"]["values"]["stutterscope_time_weighted"]),
                 (ck["p01_percentile"], rec["p01"]["values"]["stutterscope_percentile"]),
                 (ck["p01_slowest_mean"], rec["p01"]["values"]["stutterscope_slowest_mean"]),
                 (ck["p01_time_weighted"], rec["p01"]["values"]["stutterscope_time_weighted"])):
        assert abs(a / b - 1) < 1e-9, (rec["id"], a, b)   # the TypeScript and this Python agree
    rec["_ft"] = ft
    caps.append(rec)

res = {"minFrames": MIN_FRAMES, "captures": [], "summary": {}}
for rec in caps:
    res["captures"].append({k: v for k, v in rec.items() if k != "_ft"})
for name in ("p1", "p01"):
    sp = [r[name]["spreadPct"] for r in caps]
    res["summary"][name + "_spreadPct"] = {"median": statistics.median(sp), "worst": max(sp), "n": len(sp)}
    fam = [100 * (max(r[name]["values"][k] for k in PCT_FAMILY) / min(r[name]["values"][k] for k in PCT_FAMILY) - 1) for r in caps]
    res["summary"][name + "_percentile_family_spreadPct"] = {"keys": PCT_FAMILY, "median": statistics.median(fam), "worst": max(fam), "n": len(fam)}
    # distance of each definition from stutterscope's percentile figure
    byname = {}
    for r in caps:
        base = r[name]["values"]["stutterscope_percentile"]
        for k, v in r[name]["values"].items():
            byname.setdefault(k, []).append(100 * (v / base - 1))
    res["summary"][name + "_vs_stutterscope_percentile_pct"] = {k: {"median": statistics.median(v), "worst_abs": max(v, key=abs)} for k, v in byname.items()}

# tool-written summaries
yard = {}
w = [r for r in caps if r["id"].startswith("Reason7322")][0]
rows = list(csv.DictReader(open(os.path.join(HERE, "cache/Reason7322__mangohudlogs/Witchfire-Win64-Shipping_2026-08-12_14-16-42_summary.csv"))))[0]
acc = f32(0.0)                                  # logging.cpp: `float total`, summed in sorted order
for x in sorted((f32(v) for v in w["_ft"]), reverse=True):
    acc = f32(acc + x)
mango_avg_f32 = f32(1000.0) / f32(acc / len(w["_ft"]))
ms = {"p01": float(rows["0.1% Min FPS"]), "p1": float(rows["1% Min FPS"]), "avg": float(rows["Average FPS"]), "avg_recomputed_float32_sum": mango_avg_f32}
yard["mangohud_witchfire"] = {"summary_file": ms,
    "recomputed_mangohud_rule": {"p01": w["p01"]["values"]["mangohud_summary"], "p1": w["p1"]["values"]["mangohud_summary"]},
    "stutterscope": {"p01": w["stutterscope_reported"]["p01_percentile"], "p1": w["stutterscope_reported"]["p1_percentile"], "avg": w["stutterscope_reported"]["averageFps"]},
    "all_definitions_p1": w["p1"]["values"], "all_definitions_p01": w["p01"]["values"]}

fv = list(csv.reader(open(os.path.join(HERE, "cache/Pavelioso__Frameviewer/assets__FrameView_Summary.csv"))))
hdr = [h.strip() for h in fv[0]]
fvs = []
for r in fv[1:]:
    g = lambda n: float(r[hdr.index(n)])
    fvs.append({"log": r[hdr.index("Log Name")], "avg": g("Avg FPS"), "low1": g("1% Low FPS"), "low01": g("0.1% Low FPS"),
                "fps01": g("0.1% FPS"), "fps1": g("1% FPS"), "min": g("Min FPS"), "max": g("Max FPS")})
yard["frameview_summary_rows"] = fvs
yard["frameview"] = []
for r in caps:
    if not r["id"].startswith("Pavelioso"):
        continue
    ft = r["_ft"]
    n = len(ft)
    asc_fps = sorted(1000 / x for x in ft)
    row = min(fvs, key=lambda x: abs(x["avg"] - r["averageFps"]))
    assert abs(row["avg"] - r["averageFps"]) < 0.01 and abs(row["min"] - 1000 / max(ft)) < 0.01, r["id"]
    yard["frameview"].append({
        "capture": r["id"], "summary_row_log": row["log"], "frames": n,
        "match_basis": "Avg FPS, Min FPS and Max FPS agree with the summary row to its printed precision",
        "frameview": row,
        "index_rule_1pct": asc_fps[int(n * 0.01)], "index_rule_0p1pct": asc_fps[int(n * 0.001)],
        "released": r["released_reported"], "checkout": r["stutterscope_reported"], "averageFps": r["averageFps"]})
res["yardsticks"] = yard
json.dump(res, sys.stdout, indent=1)
