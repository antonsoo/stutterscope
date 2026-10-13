"""Generate synthetic byte-level capture specimens; no real game capture is claimed."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
HEADER = 'Application,MsBetweenPresents,Note\n'
NAMES = HEADER + ''.join(f'game{name}.exe,{ms},sample\n' for _ in range(12) for name, ms in [('é', 10), ('è', 50)])
CASES = []


def add(name, data, expected='rejected', frames=None, streams=None, application=None):
    path = HERE / 'fixtures' / (name + '.csv')
    path.write_bytes(data)
    case = {'id': name, 'file': 'fixtures/' + path.name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'expected': expected}
    if expected == 'parsed':
        case.update(frames=frames, streams=streams, application=application, averageFps=100)
    CASES.append(case)


def utf16(text, endian):
    return (b'\xff\xfe' if endian == 'le' else b'\xfe\xff') + text.encode('utf-16' + endian, errors='surrogatepass')


def note(raw):
    return (HEADER + 'game.exe,10,').encode() + raw + b'\n'


add('legacy-names', NAMES.encode('cp1252'))
for name, raw in [('utf8-stray', b'\xff'), ('utf8-continuation', b'\xe2\x28\xa1'), ('utf8-overlong', b'\xc0\xaf'), ('utf8-surrogate', b'\xed\xa0\x80'), ('utf8-out-of-range', b'\xf4\x90\x80\x80')]:
    add(name, note(raw))
add('utf8-truncated', note(b'')[:-1] + b'\xf0\x9f')
prefix = (HEADER + 'game.exe,10,').encode()
add('utf8-late-damage', prefix + b'x' * (65540 - len(prefix)) + b'\xff\n')
add('utf8-complete-at-sample-limit', prefix + b'x' * (65535 - len(prefix)) + b'\xc3')
for endian in ['le', 'be']:
    for name, char in [('high-surrogate', '\ud800'), ('low-surrogate', '\udc00')]:
        add('utf16' + endian + '-' + name, utf16(HEADER + 'game.exe,10,' + char + '\n', endian))
    add('utf16' + endian + '-odd-tail', utf16(HEADER + 'game.exe,10,note', endian) + b'\x01')
for name, data in [('utf8-names', NAMES.encode()), ('utf8-bom', b'\xef\xbb\xbf' + NAMES.encode()), ('utf16le-names', utf16(NAMES, 'le')), ('utf16be-names', utf16(NAMES, 'be'))]:
    add(name, data, 'parsed', 12, 2, 'gameé.exe')
add('literal-replacement', (HEADER + 'game�.exe,10,literal replacement character\n').encode(), 'parsed', 1, 1, 'game�.exe')
add('utf8-split-sample', prefix + b'x' * (65535 - len(prefix)) + '😀\n'.encode(), 'parsed', 1, 1, 'game.exe')
for endian in ['le', 'be']:
    text = HEADER + 'game.exe,10,'
    # The sample contains the high surrogate; the low surrogate is in the rest of the file.
    text += 'x' * ((65534 - 2) // 2 - len(text)) + '😀\n'
    add('utf16' + endian + '-split-sample', utf16(text, endian), 'parsed', 1, 1, 'game.exe')
(HERE / 'cases.json').write_text(json.dumps(CASES, indent=2, ensure_ascii=False) + '\n')
print(f'{len(CASES)} synthetic encoding specimens')
