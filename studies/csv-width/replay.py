"""Run the actual source, built or installed CLI on controlled CSV damage."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    results = []
    for case in json.loads((HERE / 'cases.json').read_text()):
        path = HERE / case['file']
        command = [args.node, str(args.cli.resolve()), 'summary', str(path), '--json', '--events', *case['options']]
        run = subprocess.run(command, text=True, capture_output=True, timeout=30)
        report = json.loads(run.stdout) if run.returncode == 0 else None
        observed = None
        if report:
            summary = report['summary']
            observed = dict(frames=summary['frameCount'], averageFps=summary['averageFps'],
                            skipped=report['source']['skippedRows'], hitches=summary['stutter']['hitchCount'],
                            gaps=summary['pacingCoverage']['gapBoundaries'], pairs=summary['pacingCoverage']['observedPairs'])
            report['file'] = path.name
        agrees = observed is not None and all(
            math.isclose(observed[key], value, rel_tol=1e-12) for key, value in case['expected'].items())
        results.append(dict(name=case['name'], input_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                            exit=run.returncode, stderr=run.stderr.replace(str(path), '<input>'),
                            expected=case['expected'], observed=observed, agrees=agrees, report=report))
    output = dict(node=subprocess.check_output([args.node, '--version'], text=True).strip(),
                  cases=results, agreeing=sum(case['agrees'] for case in results))
    args.out.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'cases': len(results), 'agreeing': output['agreeing']}))
    if args.verify:
        assert output['agreeing'] == len(results)


if __name__ == '__main__':
    main()
