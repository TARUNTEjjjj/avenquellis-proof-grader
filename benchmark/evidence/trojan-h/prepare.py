"""Recreate the blind TROJAN(H) inputs and separate research labels from a pinned release."""
import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

BASE = Path(__file__).resolve().parent
LOCK = json.loads((BASE / 'protocol.json').read_text())


def digest(value):
    return hashlib.sha256(value).hexdigest()


def serialized(rows):
    return (json.dumps(rows, ensure_ascii=False, indent=2) + '\n').encode()


def prepare(data, size, destination):
    if len(data) != LOCK['source']['bytes'] or digest(data) != LOCK['source']['sha256']:
        raise ValueError('Source bytes differ from the pinned release')
    groups = defaultdict(list)
    labels = {}
    for item in json.loads(data):
        case = f"trojan-h-{item['global_idx']:03d}"
        problem = f"usamo-2025-{item['problem_idx']}"
        rubric = [{'id': f'c{i}', 'description': f"{c['title']}. {c['desc']}", 'points': int(c['points'])}
                 for i, c in enumerate(item['grading_scheme'], 1)]
        if sum(c['points'] for c in rubric) != 7 or case in labels:
            raise ValueError(f'Invalid source rubric or duplicate case: {case}')
        question = {'id': problem, 'statement': item['problem'], 'solution': item['sample_solution'],
                    'rubric': rubric, 'maxMarks': 7}
        groups[problem].append({'id': case, 'category': 'research-authored-USAMO-variant',
                                'question': question, 'answer': item['solution']})
        labels[case] = {'id': case, 'problem': problem, 'score': int(item['awarded_points']),
                        'maxMarks': 7, 'source': 'human'}
    if len(groups) != 6 or any(len(rows) != 8 for rows in groups.values()):
        raise ValueError('Expected eight variants per USAMO problem')
    ordered = sorted(groups, key=lambda p: digest(('noether-problems-v1:' + p).encode()))
    for rows in groups.values():
        rows.sort(key=lambda r: digest(('noether-v1:' + r['id']).encode()))
    fixtures = [groups[p][i] for i in range(8) for p in ordered][:size]
    lock = LOCK['selections'][str(size)]
    if [r['id'] for r in fixtures] != lock['caseIds'] or digest(serialized(fixtures)) != lock['fixtureSha256']:
        raise ValueError('Selection or blind fixture differs from the frozen protocol')
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'fixtures.json').write_bytes(serialized(fixtures))
    (destination / 'targets.json').write_bytes(serialized([labels[r['id']] for r in fixtures]))
    print(f'Prepared {size} blind cases, {lock["fixtureSha256"]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', type=int, choices=(6, 12, 24, 48), default=24)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--source-file', type=Path, help='Read a previously fetched, hash-verified release.')
    args = parser.parse_args()
    if args.source_file:
        raw = args.source_file.read_bytes()
    else:
        with urlopen(LOCK['source']['url'], timeout=90) as response:
            raw = response.read(LOCK['source']['bytes'] + 1)
    prepare(raw, args.size, args.out)
