"""Exercise the real CLI with synthetic, analytically known present streams.

The expected frame lists are specified here, independently of the TypeScript
parser. No application code is imported. --verify checks the repaired CLI.
"""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def cases():
    for fmt in ['presentmon1', 'presentmon2', 'ocat', 'capframex', 'frameview']:
        ft = 'msBetweenPresents' if fmt == 'presentmon1' else 'FrameTime' if fmt == 'presentmon2' else 'MsBetweenPresents'
        def csv(identity, rows):
            marker = ',msInPresentAPI' if fmt == 'presentmon1' else ',GPU0Util(%)' if fmt == 'frameview' else ''
            preamble = '//GameName=controlled\n' if fmt == 'capframex' else ''
            return preamble + f'{identity},{ft},CPUBusy,GPUBusy{marker}\n' + '\n'.join(rows) + '\n'
        mixed = csv('Application,SwapChainAddress', [
            'game.exe,0x1,10,2,3', 'dwm.exe,0x1,40,4,5', 'game.exe,0x1,10,6,7',
            'dwm.exe,0x1,40,8,9', 'game.exe,0x1,10,10,11'])
        yield fmt, 'mixed-default', mixed, [], [[10, 10, 10]], 'game.exe', 2, 0
        yield fmt, 'auto-detection', mixed, [], [[10, 10, 10]], 'game.exe', 2, 0
        yield fmt, 'mixed-compositor', mixed, ['--stream', 'dwm.exe'], [[40, 40]], 'dwm.exe', 2, 0
        yield fmt, 'second-swapchain', csv('Application,SwapChainAddress', [
            'game.exe,0x1,10', 'game.exe,0x2,80', 'game.exe,0x1,10', 'game.exe,0x2,80', 'game.exe,0x1,10']), [
                '--stream', 'app:["game.exe","0x2"]'], [[80, 80]], 'game.exe', 2, 0
        for name, row, segments in [
            ('skip-other-application', 'overlay.exe,0x1,NA', [[60, 120]]),
            ('skip-same-application', 'game.exe,0x1,NA', [[60], [120]]),
            ('blank-application', ',0x1,10', [[60], [120]]),
            ('blank-swapchain', 'game.exe,,10', [[60], [120]]),
        ]:
            yield fmt, name, csv('Application,SwapChainAddress', [
                'game.exe,0x1,60', row, 'game.exe,0x1,120']), [], segments, 'game.exe', 1, 1
        yield fmt, 'blank-pid', csv('Application,ProcessID,SwapChainAddress', [
            'game.exe,1,0x1,60', 'game.exe,,0x1,10', 'game.exe,1,0x1,120']), [], [[60], [120]], 'game.exe', 1, 1
        yield fmt, 'all-unidentified', csv('Application,SwapChainAddress', [
            ',0x1,10', ',0x1,20']), [], None, None, 0, 2
        yield fmt, 'full-identity-control', csv('Application,ProcessID,SwapChainAddress', [
            'game.exe,1,0x1,10,2,3', 'dwm.exe,2,0x1,40,4,5', 'game.exe,1,0x1,10,6,7',
            'dwm.exe,2,0x1,40,8,9', 'game.exe,1,0x1,10,10,11']), [], [[10, 10, 10]], 'game.exe', 2, 0


def oracle(segments, application, streams, skipped):
    if segments is None:
        return {'refused': True}
    values = [v for s in segments for v in s]
    pairs = [abs(b-a) for s in segments for a, b in zip(s, s[1:])]
    return {'refused': False, 'application': application, 'streams': streams,
            'frames': len(values), 'averageFps': float(Fraction(1000*len(values), sum(values))),
            'masdMs': float(Fraction(sum(pairs), len(pairs))) if pairs else None,
            'pacingCoverage': {'observedPairs': len(pairs), 'gapBoundaries': len(segments)-1},
            'skippedRows': skipped, 'stutterEvents': 0}


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('--cli', type=Path, required=True)
    p.add_argument('--node', default='node')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--verify', action='store_true')
    args = p.parse_args()
    records = []
    with tempfile.TemporaryDirectory(prefix='streams-') as tmp:
        for fmt, name, text, flags, segments, app, streams, skipped in cases():
            source = Path(tmp)/f'{fmt}-{name}.csv'
            source.write_text(text)
            format_flags = [] if name == 'auto-detection' else ['--format', fmt]
            proc = subprocess.run([args.node, str(args.cli), 'summary', str(source), *format_flags,
                                   '--json', '--events', *flags], capture_output=True, text=True, timeout=30)
            expected = oracle(segments, app, streams, skipped)
            report = json.loads(proc.stdout) if proc.returncode == 0 else None
            observed = {'refused': True}
            if report is not None:
                report['file'] = source.name
                summary = report['summary']
                observed = dict(refused=False, application=report['source'].get('application'), streams=len(report['source'].get('streams', [])),
                                frames=summary['frameCount'], averageFps=summary['averageFps'], masdMs=summary['masdMs'],
                                pacingCoverage=summary['pacingCoverage'], skippedRows=report['source']['skippedRows'],
                                stutterEvents=summary['stutter']['stutterEventCount'])
            checks = {k: (abs(observed[k]-v) < 1e-10 if isinstance(v, float) and isinstance(observed.get(k), (int, float))
                          else observed.get(k) == v) for k, v in expected.items()}
            records.append(dict(name=f'{fmt}-{name}', csv=text, sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                                flags=flags, exitCode=proc.returncode, stderr=proc.stderr.replace(str(source), '<input>'),
                                expected=expected, observed=observed, agrees=all(checks.values()), checks=checks, report=report))
    tree = args.cli.resolve().parent.parent
    ext = args.cli.suffix
    result = dict(node=subprocess.check_output([args.node, '--version'], text=True).strip(),
                  runtimeSha256={str(f.relative_to(tree)): hashlib.sha256(f.read_bytes()).hexdigest()
                                 for f in sorted(tree.rglob('*'+ext))}, cases=records)
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'cases': len(records), 'agrees': sum(r['agrees'] for r in records)}))
    if args.verify:
        assert all(r['agrees'] for r in records), [r['name'] for r in records if not r['agrees']]


if __name__ == '__main__':
    main()
