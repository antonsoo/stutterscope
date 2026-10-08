"""Fetch the real captures listed in SOURCES at pinned commits into cache/ and write manifest.json.

Run: python3 -I fetch.py   (network: raw.githubusercontent.com only, <=4 concurrent)
"""
import hashlib, json, os, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "stutterscope-study/0.1 (research; anton@praviel.com)"

PM = ("GameTechDev/PresentMon", "38ec4a7e2998a7c4eea2c3c7dd4772f29ef32f76", "MIT",
      "Gold-file regression fixtures rendered from Intel's own ETL traces")
SOURCES = []
for i in range(6):
    for suf in ("", "_v1", "_v2"):
        SOURCES.append((*PM, f"Tests/Gold/test_case_{i}{suf}.csv"))
SOURCES += [
    ("Reason7322/mangohudlogs", "72a3bfac974b776581e382b3e2bbe2218e40c667", "none stated", "user MangoHud log, Witchfire", "Witchfire-Win64-Shipping_2026-08-12_14-16-42.csv"),
    ("Reason7322/mangohudlogs", "72a3bfac974b776581e382b3e2bbe2218e40c667", "none stated", "MangoHud summary of the log above", "Witchfire-Win64-Shipping_2026-08-12_14-16-42_summary.csv"),
    ("xD3I/Benchmarks", "6dc50486ac5289c10c99704234ec3fe38d5b4421", "Unlicense", "example file", "examples/mangohud.csv"),
    ("xD3I/Benchmarks", "6dc50486ac5289c10c99704234ec3fe38d5b4421", "Unlicense", "example file", "examples/frameview-1-6.csv"),
]
FS = ("erkexzcx/flightlesssomething", "ab582e57e7baf0dcbba80f9f13b758ec0da2dd18", "none detected by GitHub", "test data of a benchmark-site clone")
for p in ["afterburner/GOD.OF.WAR_Windows.csv", "afterburner/RE3_Windows.csv", "afterburner/u4_Windows.csv",
          "mangohud/run1.csv", "mangohud/run2.csv", "mangohud/run3.csv"]:
    SOURCES.append((*FS, "testdata/" + p))
CL = ("cosmiclf/Intel_PresentMon_Performance_Analysis", "afceff47fe2ebc74181b4d8c6d0beceb2051e9dd", "none stated", "user PresentMon logs")
for p in ["pmcap-r5apex_dx12.exe-250709-222018.csv", "pmcap-r5apex_dx12.exe-250709-222519.csv",
          "pmcap-superposition.exe-250719-215451.csv", "pmcap-superposition.exe-250719-220716.csv"]:
    SOURCES.append((*CL, "Logs/" + p))
PV = ("Pavelioso/Frameviewer", "084d4cb69e35839fd4ae2738119429f5cddd2ee6", "none stated", "user FrameView logs, Witcher 3")
for p in ["witcher_3.csv", "witcher_3_gdrive.csv", "witcher_3_test.csv", "FrameView_Summary.csv", "FrameView_Summary_gdrive.csv"]:
    SOURCES.append((*PV, "assets/" + p))


def get(s):
    repo, sha, lic, note, path = s
    url = f"https://raw.githubusercontent.com/{repo}/{sha}/{urllib.parse.quote(path)}"
    dest = os.path.join(HERE, "cache", repo.replace("/", "__"), path.replace("/", "__"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(4):
        try:
            if not os.path.exists(dest):
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                    f.write(r.read())
            break
        except Exception as e:
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(url)
    b = open(dest, "rb").read()
    return {"repo": repo, "commit": sha, "path": path, "url": url, "licence": lic, "note": note,
            "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(), "local": os.path.relpath(dest, HERE)}


if __name__ == "__main__":
    with ThreadPoolExecutor(4) as ex:
        out = list(ex.map(get, SOURCES))
    json.dump({"fetched_by": "fetch.py", "files": out}, open(os.path.join(HERE, "manifest.json"), "w"), indent=1)
    print(len(out), "files", sum(o["bytes"] for o in out), "bytes")
