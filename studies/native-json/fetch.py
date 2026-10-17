"""Fetch pinned, unmodified public recordings into the ignored cache.

No capture bytes are redistributed by this repository. Run: python3 fetch.py
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

HERE = Path(__file__).resolve().parent
REPO = "retowyss/pc-benchmarking-r-griddb"
COMMIT = "4db96bed6b590539fad0ddfa477ce39e7be712dc"
FILES = {
    "CapFrameX-ACValhalla.exe-1.json": "cb21d1729e4d59bb2dea67e8b8e8cd20dfe643c473bf6641422b5c0a37f9127d",
    "CapFrameX-Cyberpunk2077.exe.json": "b3bd9c932a44708801ef636688627c00dea220a9180c4886496673a589d995b9",
    "CapFrameX-DOOMEternalx64vk.exe-1.json": "47c7e32c62d4aa5c312a5e47719ed35db9e810048b58c785bdde6021eb234e3d",
    "CapFrameX-DOOMEternalx64vk.exe-2.json": "7d53914bbc04d5d3fc6c22d77a3796874b1694651ae69e3fd2d0441708d2e562",
    "CapFrameX-ROLLERDROME.exe-1.json": "3a3f9456aa3ecfd0ed7af2008d142c6d513ea38f5cccf815aaf602d08a4a55b8",
}

def fetch(item):
    name, expected = item
    target = HERE / "cache" / name
    url = f"https://raw.githubusercontent.com/{REPO}/{COMMIT}/data/{name}"
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "stutterscope-native-study"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    else:
        data = target.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError(f"capture hash mismatch: {name}")
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(data)
    return {"file": name, "repository": REPO, "commit": COMMIT, "url": url, "bytes": len(data), "sha256": actual,
            "license": "No repository license found; fetch original bytes for local verification only"}

if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(fetch, FILES.items()))
    (HERE / "manifest.json").write_text(json.dumps({"files": records}, indent=2) + "\n")
    print(f"Verified {len(records)} native recordings; {sum(r['bytes'] for r in records)} bytes")
