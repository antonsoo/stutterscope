"""Construct small CSV corruption controls; none is a game benchmark."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    records = []

    def save(name, text, options, expected):
        path = HERE / 'fixtures' / (name + '.csv')
        path.write_text(text)
        records.append(dict(name=name, file='fixtures/' + path.name, options=options, expected=expected))

    for fmt in ['presentmon1', 'presentmon2', 'ocat', 'capframex', 'frameview']:
        ft = 'msBetweenPresents' if fmt == 'presentmon1' else 'FrameTime' if fmt == 'presentmon2' else 'MsBetweenPresents'
        marker = ',msInPresentAPI' if fmt == 'presentmon1' else ',GPU0Util(%)' if fmt == 'frameview' else ''
        prefix = '//GameName=controlled\n' if fmt == 'capframex' else ''
        header = f'Application,ProcessID,SwapChainAddress,{ft},CPUBusy,GPUBusy{marker}'
        good = 'game.exe,42,0x1,10,4,5' + (',1' if marker else '')
        bad = 'game.exe,42,0x1,1000,10,4,5' + (',1' if marker else '')
        save(fmt, prefix + '\n'.join([header, good, good, bad, good, good]) + '\n',
             ['--format', fmt], dict(frames=4, averageFps=100, skipped=1, hitches=0, gaps=1, pairs=2))
    save('mangohud', 'fps,frametime,cpu_load\n100,10,25\n100,10,25\n1,1000,10,25\n100,10,25\n100,10,25\n',
         ['--format', 'mangohud'], dict(frames=4, averageFps=100, skipped=1, hitches=0, gaps=1, pairs=2))
    save('generic', 'frame_time_ms,dropped\n10,0\n10,0\n1000,10,0\n10,0\n10,0\n',
         ['--format', 'generic', '--generic-column', 'frame_time_ms', '--generic-kind', 'frametime_ms'],
         dict(frames=4, averageFps=100, skipped=1, hitches=0, gaps=1, pairs=2))
    save('timestamp', 'clock_ms\n0\n10\n1000,20\n30\n40\n',
         ['--format', 'generic', '--generic-column', 'clock_ms', '--generic-kind', 'timestamp_ms_cumulative'],
         dict(frames=2, averageFps=100, skipped=2, hitches=0, gaps=1, pairs=0))
    save('unknown-stream', 'Application,ProcessID,SwapChainAddress,FrameTime,CPUBusy,GPUBusy\n'
         'game.exe,42,0x1,60,1,2\noverlay.exe,43,0x1,70,1,2\n'
         'game.exe,42,0x1,1000,10,1,2\ngame.exe,42,0x1,120,1,2\noverlay.exe,43,0x1,140,1,2\n',
         ['--format', 'presentmon2'], dict(frames=2, averageFps=1000/90, skipped=1, hitches=2, gaps=1, pairs=0))
    (HERE / 'cases.json').write_text(json.dumps(records, indent=2) + '\n')


if __name__ == '__main__':
    main()
