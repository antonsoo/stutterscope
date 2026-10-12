"""Byte-verify the existing pinned capture cache and compare both real CLIs.

This is compatibility evidence on cached public data, not a new capture/download
or a measurement of detector accuracy. Current refusals are retained as refusals.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
CORPUS = HERE.parent/'real-captures'


def run(cli, file):
    p = subprocess.run(['node', str(cli), 'summary', str(file), '--json', '--events'], capture_output=True, text=True)
    if p.returncode:
        return {'status': 'refused', 'exit': p.returncode, 'message': p.stderr.strip().replace(str(file), '<capture>')}
    r = json.loads(p.stdout)
    r.pop('file', None)
    return {'status': 'parsed', 'report': r}


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('--before', required=True, type=Path)
    p.add_argument('--after', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    args = p.parse_args()
    receipt = []
    for f in json.loads((CORPUS/'manifest.json').read_text())['files']:
        file = CORPUS/f['local']
        data = file.read_bytes()
        assert len(data) == f['bytes'] and hashlib.sha256(data).hexdigest() == f['sha256'], f['local']
        if not f['path'].lower().endswith('.csv') or 'summary' in f['path'].lower():
            continue
        a, b = run(args.before, file), run(args.after, file)
        item = {'url': f['url'], 'sha256': f['sha256'], 'bytes': len(data), 'beforeStatus': a['status'], 'afterStatus': b['status']}
        assert a['status'] == b['status'], f['path']
        if a['status'] == 'refused':
            assert a == b
            item['refusal'] = b
        else:
            ra, rb = a['report'], b['report']
            ma, mb = ra['summary'], rb['summary']
            changed = [key for key in ma if ma[key] != mb[key]]
            # Independent durations/distributions/telemetry must remain byte-equivalent.
            assert all(key in {'masdMs', 'stutter'} for key in changed), (f['path'], changed)
            assert ra['source'] == rb['source']
            assert all(ma['stutter'][k] == mb['stutter'][k] for k in ['hitchCount', 'totalHitchTimeMs', 'hitchTimeFraction'])
            item.update(frameCount=mb['frameCount'], pacingCoverage=mb['pacingCoverage'], changedMetrics=changed,
                        beforeEpisodes=len(ra['episodes']), afterEpisodes=len(rb['episodes']))
            if changed or ra['episodes'] != [{k: v for k, v in e.items() if k not in {'startsAfterGap', 'endsBeforeGap'}} for e in rb['episodes']]:
                item.update(beforeReport=ra, afterReport=rb)
        receipt.append(item)
    args.out.write_text(json.dumps({'cachedInputsOnly': True, 'captures': receipt}, indent=2)+'\n')
    print(json.dumps({'captures': len(receipt), 'parsed': sum(r['afterStatus'] == 'parsed' for r in receipt),
                      'changed': sum(bool(r.get('changedMetrics')) for r in receipt)}))


if __name__ == '__main__':
    main()
