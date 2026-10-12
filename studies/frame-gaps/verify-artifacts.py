"""Hash the tested archive's inputs, served build and separately installed CLI."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(__doc__)
p.add_argument('--archive', required=True, type=Path)
p.add_argument('--installed', required=True, type=Path)
p.add_argument('--package', required=True, type=Path)
p.add_argument('--url', required=True)
p.add_argument('--out', required=True, type=Path)
a = p.parse_args()

def entry(path, content):
    return {'path': str(path), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}

paths = subprocess.check_output(['git', 'ls-files', '-z', 'src', 'examples', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'tsconfig.cli.json', 'vite.config.ts', 'vite.csp.ts'], cwd=ROOT).decode().strip('\0').split('\0')
inputs = []
for path in paths:
    content = (ROOT/path).read_bytes()
    assert content == (a.archive/path).read_bytes(), path
    inputs.append(entry(path, content))
served = []
for path in sorted((a.archive/'dist').rglob('*')):
    if not path.is_file():
        continue
    rel = path.relative_to(a.archive/'dist')
    with urllib.request.urlopen(a.url.rstrip('/')+'/'+urllib.parse.quote(str(rel)), timeout=20) as response:
        content = response.read()
        assert content == path.read_bytes(), str(rel)
        served.append(entry(rel, content))
installed = []
for path in sorted((a.archive/'dist-cli').rglob('*.js')):
    rel = path.relative_to(a.archive/'dist-cli')
    content = path.read_bytes()
    assert content == (a.installed/'dist-cli'/rel).read_bytes(), str(rel)
    installed.append(entry(rel, content))
result = {'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'inputFiles': inputs, 'servedBuildFiles': served, 'installedRuntimeFiles': installed,
          'package': entry(a.package.name, a.package.read_bytes()),
          'scope': 'Local build and installed package. This does not verify the hosted demo or an npm registry release.'}
a.out.write_text(json.dumps(result, indent=2)+'\n')
print(f'{len(inputs)} input files, {len(served)} served files, {len(installed)} installed modules byte-identical')
