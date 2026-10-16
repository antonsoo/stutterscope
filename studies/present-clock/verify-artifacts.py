"""Verify a pinned clean archive, installed CLI, served bytes and real exports.

python3 studies/present-clock/verify-artifacts.py SCRATCH BASE_URL
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCRATCH = Path(sys.argv[1]).resolve()
BASE = sys.argv[2]
SOURCE = (SCRATCH / "source-revision.txt").read_text().strip()


def digest(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def load(path):
    return json.loads(path.read_bytes())


after = load(HERE / "results/after.json")
assert (SCRATCH / "clean-replay.json").read_bytes() == (HERE / "results/after.json").read_bytes()
for index in [0, 1]:
    assert load(SCRATCH / f"installed-{index}.json")["cases"] == after["cases"]
checks = {}
for name, command in [("install", "npm ci"), ("lint", "npm run lint"), ("typecheck", "npm run typecheck"),
                      ("unit", "npm test"), ("build", "npm run build"), ("browser", "npm run test:browser")]:
    log = (SCRATCH / f"clean-{name}.log").read_bytes()
    checks[name] = dict(command=command, exitCode=0, **digest(log))
assert re.search(r"\b362 passed", (SCRATCH / "clean-unit.log").read_text())
assert re.search(r"\b86 passed", (SCRATCH / "clean-browser.log").read_text())

inputs = {}
for name in subprocess.check_output(["git", "ls-tree", "-r", "--name-only", SOURCE], cwd=REPO, text=True).splitlines():
    if not (name.startswith(("src/", "examples/", "package", "tsconfig", "vite.")) or name in ["README.md", "LICENSE", "index.html"]):
        continue
    expected = subprocess.check_output(["git", "show", f"{SOURCE}:{name}"], cwd=REPO)
    path = SCRATCH / "clean" / name
    if path.is_symlink():
        assert str(path.readlink()).encode() == expected
        inputs[name] = dict(symlink=expected.decode())
    else:
        assert path.read_bytes() == expected, name
        inputs[name] = digest(expected)

installed = SCRATCH / "consumer/node_modules/@antonsoloviev/stutterscope"
modules = {}
for path in sorted((SCRATCH / "clean/dist-cli").rglob("*")):
    if not path.is_file():
        continue
    name = path.relative_to(SCRATCH / "clean").as_posix()
    assert path.read_bytes() == (installed / name).read_bytes(), name
    modules[name] = digest(path.read_bytes())
for name in ["README.md", "LICENSE", "package.json"]:
    assert (SCRATCH / "clean" / name).read_bytes() == (installed / name).read_bytes(), name
    modules[name] = digest((installed / name).read_bytes())
assert digest((SCRATCH / "clean/dist-cli/cli/index.js").read_bytes())["sha256"] == load(HERE / "results/performance.json")["implementation"]["after"]

served = {}
for path in sorted((SCRATCH / "clean/dist").rglob("*")):
    if not path.is_file():
        continue
    name = path.relative_to(SCRATCH / "clean/dist").as_posix()
    with urllib.request.urlopen(BASE + urllib.parse.quote(name), timeout=30) as response:
        data = response.read()
        assert response.status == 200
    assert data == path.read_bytes(), name
    served[name] = digest(data)
assert (SCRATCH / "clean/examples/native-filtering/filtered-presents.csv").read_bytes() == (HERE / "fixtures/test_case_5_v1-exclude-dropped.csv").read_bytes()

browsers = {}
for phase, folder, count in [("before", "browser-before", 6), ("after", "browser-clean", 10)]:
    views = load(SCRATCH / folder / "browser.json")
    assert len(views) == 4
    for view in views:
        assert len(view["flows"]) == count and not view["errors"] and not view["externalRequests"]
        assert not view["nonFontHttpRequestsAfterDisconnect"] and view["noPageOverflow"] and not view["axeViolations"]
        if phase == "after":
            assert view["builtinExample"] and view["recomputationAndIntervals"]
        for flow in view["flows"]:
            assert flow["matchesCompleteCliReport"] and digest((SCRATCH / folder / flow["file"]).read_bytes())["sha256"] == flow["sha256"]
    browsers[phase] = views
    for view in views:
        for flow in view["flows"]:
            if view["engine"] == "chromium" and view["width"] == 1440 and flow["name"] == "frameview-native-excerpt":
                shutil.copyfile(SCRATCH / folder / flow["file"], HERE / "results" / f"browser-{phase}-frameview.json")

screenshots = [("browser-before", "chromium-1440-native.png", "before.png"),
    ("browser-clean", "chromium-1440-native.png", "after.png"),
    ("browser-clean", "chromium-375-clock.png", "clock-phone.png"),
    ("browser-clean", "chromium-375-example.png", "example-phone.png"),
    ("browser-clean", "chromium-1440-card.png", "report-card.png"),
    ("browser-clean", "chromium-375-hitches.png", "hitches-phone.png")]
assets = REPO / "docs/assets/present-clock"
for folder, name, target in screenshots:
    shutil.copyfile(SCRATCH / folder / name, assets / target)
for suffix in ["md", "png"]:
    name = "chromium-1440-native.md" if suffix == "md" else "chromium-1440-card.png"
    shutil.copyfile(SCRATCH / "browser-clean" / name, HERE / "results" / ("browser-native." + suffix))

(HERE / "results/browser.json").write_text(json.dumps(browsers, indent=2) + "\n")
(HERE / "results/verification.json").write_text(json.dumps(dict(testedSource=SOURCE,
    scope="Pinned clean source archive, separately installed local tarball and local browser/HTTP. Public source, public hosting and registry status are separate receipts.",
    checks=checks, unitChecks=362, productionBrowserChecks=86, beforeBrowserExports=24, afterBrowserExports=40,
    replays=dict(workflows=21, sourceAndInstalledCasesMatch=True), installedCli=load(SCRATCH / "installed-cli-checks.json"),
    sourceArchive=digest((SCRATCH / "source.tar").read_bytes()), package=digest((SCRATCH / "antonsoloviev-stutterscope-0.2.5.tgz").read_bytes()),
    sourceInputs=inputs, installedFiles=modules, servedFiles=served, screenshots={target:digest((assets / target).read_bytes()) for _, _, target in screenshots}), indent=2) + "\n")
print(json.dumps(dict(sourceInputs=len(inputs), installedFiles=len(modules), servedFiles=len(served))))
