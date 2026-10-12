"""Whole-CLI time and peak RSS on one fixed 500k-row synthetic capture (Linux time)."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import statistics
import subprocess
import tempfile

p = argparse.ArgumentParser(__doc__)
p.add_argument('--before', required=True)
p.add_argument('--after', required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
with tempfile.TemporaryDirectory(prefix='stutterscope-gap-perf-') as tmp:
    directory = Path(tmp)
    fixture = directory/'synthetic.csv'
    rows = ['FrameTime,CPUBusy,GPUBusy']
    for i in range(500_000):
        value = 'NA' if i % 1000 == 999 else str(10 + i % 5)
        rows.append(f'{value},4,6')
    fixture.write_text('\n'.join(rows)+'\n')
    result = {'synthetic': True, 'inputRows': 500_000, 'inputBytes': fixture.stat().st_size,
              'inputSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
              'platform': platform.platform(), 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
              'runs': []}
    for repetition in range(4):
        for label, cli in [('before', a.before), ('after', a.after)]:
            timing = directory/'time.txt'
            output = subprocess.check_output(['/usr/bin/time', '-f', '%e %M', '-o', str(timing),
                                             'node', cli, 'summary', str(fixture), '--json'], text=True)
            report = json.loads(output)
            assert report['summary']['frameCount'] == 499_500
            elapsed, rss = timing.read_text().split()
            if repetition:  # One warmup per build; retain all three measured runs.
                result['runs'].append({'build': label, 'seconds': float(elapsed), 'peakRssKiB': int(rss),
                                       'pacingCoverage': report['summary'].get('pacingCoverage')})
    result['medians'] = {label: {key: statistics.median(r[key] for r in result['runs'] if r['build'] == label)
                               for key in ['seconds', 'peakRssKiB']} for label in ['before', 'after']}
    a.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result['medians']))
