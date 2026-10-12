"""Compare full browser exports with the independently invoked installed CLI."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
p = argparse.ArgumentParser(__doc__)
p.add_argument('--cli', required=True, type=Path)
p.add_argument('--browsers', required=True, type=Path)
p.add_argument('--out', required=True, type=Path)
a = p.parse_args()
cases = {
    'first': ('hitches', []),
    'recomputed': ('hitches', ['--hitch-ms', '100']),
    'selected': ('hitches', ['--hitch-ms', '100', '--start', '.06']),
    'restored': ('hitches', ['--hitch-ms', '100']),
    'regime': ('regime', []),
    'game': ('interleaved', []),
    'overlay': ('interleaved', ['--stream', '2:0x2']),
}
results = []
for case, (file, options) in cases.items():
    mapping = ['--format', 'generic', '--generic-column', 'frame_time_ms', '--generic-kind', 'frametime_ms'] if file != 'interleaved' else []
    proc = subprocess.run(['node', str(a.cli), 'summary', str(HERE/'fixtures'/f'{file}.csv'), '--json', '--events', *mapping, *options], capture_output=True, text=True, check=True)
    native = json.loads(proc.stdout)
    expected = {key: native[key] for key in ['schemaVersion', 'source', 'analysis', 'episodes']}
    expected['metrics'] = native['summary']
    for b in json.loads(a.browsers.read_text()):
        actual = {key: b['observations'][case][key] for key in expected}
        assert actual == expected, (case, b['browser'], b['width'])
        results.append({'case': case, 'browser': b['browser'], 'width': b['width'], 'completeReportMatches': True,
                        'reportSha256': hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(',', ':')).encode()).hexdigest()})
a.out.write_text(json.dumps(results, indent=2)+'\n')
print(f'{len(results)} complete browser reports match the installed CLI')
