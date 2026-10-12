"""Synthetic source-gap arithmetic through a real CLI; no application code imports.

The oracle uses explicitly retained observations partitioned into uninterrupted
segments. It sorts each local window independently, excludes cross-segment pairs,
and groups slow frames only within a segment. --verify is for the repaired CLI.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def cases():
    result = []
    formats = {
        'generic': ('ms', '', ['--generic-column', 'ms', '--generic-kind', 'frametime_ms']),
        'presentmon1': ('msBetweenPresents', '', []),
        'presentmon2': ('FrameTime', '', []),
        'frameview': ('MsBetweenPresents', '', []),
        'ocat': ('MsBetweenPresents', '', []),
        'capframex': ('//GameName=demo\nMsBetweenPresents', '', []),
        'mangohud': ('fps,frametime,cpu_load', '20,{},5', []),
    }
    for fmt, (header, template, options) in formats.items():
        for name, values, segments in [
            ('hitches', ['60', 'NA', '120'], [[60], [120]]),
            ('regime', ['10', '10', '10', 'NA', '80'], [[10, 10, 10], [80]]),
            ('complete', ['60', '120'], [[60, 120]]),
        ]:
            rows = [template.format(v) if template else v for v in values]
            result.append(dict(name=f'{fmt}-{name}', text='\n'.join([header, *rows])+'\n',
                               args=['--format', fmt, *options], segments=segments))
    for name, text, kind, segments, extra in [
        ('timestamp', '0\n60\nNA\n300\n420', 'timestamp_ms_cumulative', [[60], [120]], []),
        ('clock-reset', '0\n60\n5\n125', 'timestamp_ms_cumulative', [[60], [120]], []),
        ('seconds', '0.06\nNA\n0.12', 'frametime_s', [[60], [120]], []),
        ('microseconds', '60000\nNA\n120000', 'frametime_us', [[60], [120]], []),
        ('fps', '10\n0\n5', 'fps', [[100], [200]], []),
        ('negative', '60\n-1\n120', 'frametime_ms', [[60], [120]], []),
        ('overflow', '0.06\n1e308\n0.12', 'frametime_s', [[60], [120]], []),
        ('zero', '60\n0\n120', 'frametime_ms', [[60, 0, 120]], []),
        ('edges', 'NA\n60\n120\nNA', 'frametime_ms', [[60, 120]], []),
        ('interval-across-gap', '10\n60\nNA\n120\n10', 'frametime_ms', [[60], [120]], ['--start', '.01', '--end', '.19']),
    ]:
        result.append(dict(name=name, text='ms\n'+text+'\n', segments=segments,
                           args=['--format', 'generic', '--generic-column', 'ms', '--generic-kind', kind, *extra]))
    header = 'Application,ProcessID,SwapChainAddress,FrameTime,CPUBusy,GPUBusy\n'
    for name, middle, segments in [
        ('other-stream', 'overlay,2,0x2,NA,1,1', [[60, 120]]),
        ('other-swapchain', 'game,1,0x2,NA,1,1', [[60, 120]]),
        ('same-stream', 'game,1,0x1,NA,1,1', [[60], [120]]),
        ('unknown-stream', ',,,NA,1,1', [[60], [120]]),
    ]:
        result.append(dict(name=name, text=header+'game,1,0x1,60,1,1\n'+middle+'\ngame,1,0x1,120,1,1\n',
                           args=['--format', 'presentmon2'], segments=segments))
    return result


def oracle(segments):
    pairs = [abs(b-a) for segment in segments for a, b in zip(segment, segment[1:])]
    flags, episodes, offset = [], [], 0
    for segment in segments:
        current = None
        for i, value in enumerate(segment):
            median = statistics.median(segment[max(0, i-10):i+11])
            stutter = median > 0 and value > 2 * median
            if stutter:
                flags.append(offset+i)
            if stutter or value > 50:
                if current is None:
                    current = {'frameCount': 0, 'totalTimeMs': 0}
                    episodes.append(current)
                current['frameCount'] += 1
                current['totalTimeMs'] += value
            else:
                current = None
        offset += len(segment)
    values = [v for s in segments for v in s]
    return {'masdMs': statistics.mean(pairs) if pairs else None,
            'pacingCoverage': {'observedPairs': len(pairs), 'gapBoundaries': len(segments)-1},
            'stutterFrameIndices': flags, 'hitchCount': sum(v > 50 for v in values),
            'frameCount': len(values), 'durationMs': math.fsum(values), 'episodes': episodes}


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('--cli', type=Path, default=ROOT/'dist-cli/cli/index.js')
    p.add_argument('--node', default='node')
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--verify', action='store_true')
    args = p.parse_args()
    results = []
    with tempfile.TemporaryDirectory(prefix='stutterscope-gaps-') as tmp:
        for case in cases():
            fixture = Path(tmp)/(case['name']+'.csv')
            fixture.write_text(case['text'])
            proc = subprocess.run([args.node, str(args.cli), 'summary', str(fixture), '--json', '--events', *case['args']], capture_output=True, text=True, check=True)
            report = json.loads(proc.stdout)
            report['file'] = fixture.name
            summary = report['summary']
            expected = oracle(case['segments'])
            observed = {key: summary.get(key) for key in ['masdMs', 'pacingCoverage', 'frameCount']}
            observed.update(stutterFrameIndices=summary['stutter']['stutterFrameIndices'], hitchCount=summary['stutter']['hitchCount'],
                            durationMs=summary['durationSec']*1000,
                            episodes=[{k: e[k] for k in ['frameCount', 'totalTimeMs']} for e in report['episodes']])
            checks = {k: (math.isclose(observed[k], v, abs_tol=1e-9) if isinstance(v, (float, int)) else observed[k] == v) for k, v in expected.items()}
            agrees = all(checks.values())
            behavior_agrees = all(v for k, v in checks.items() if k != 'pacingCoverage')
            results.append({**case, 'sha256': hashlib.sha256(fixture.read_bytes()).hexdigest(), 'oracle': expected, 'observed': observed, 'agrees': agrees, 'behaviorAgrees': behavior_agrees, 'report': report})
    tree = args.cli.resolve().parent.parent
    receipt = {'node': subprocess.check_output([args.node, '--version'], text=True).strip(),
               'runtimeSha256': {str(f.relative_to(tree)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(tree.rglob('*.js'))}, 'cases': results}
    args.out.write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'cases': len(results), 'agrees': sum(r['agrees'] for r in results), 'behaviorAgrees': sum(r['behaviorAgrees'] for r in results), 'output': str(args.out)}))
    if args.verify:
        assert all(r['agrees'] for r in results), [r['name'] for r in results if not r['agrees']]


if __name__ == '__main__':
    main()
