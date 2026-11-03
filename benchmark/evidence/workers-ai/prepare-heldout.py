"""Reproduce both preregistered V2 USAMO frames from the pinned 48 blind fixtures. Reads no labels."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('blind48', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
policy = json.loads((Path(__file__).resolve().parent.parent / 'trojan-h/protocol.json').read_text())
source = args.blind48.read_bytes()
if sha256(source).hexdigest() != policy['selections']['48']['fixtureSha256']:
    raise ValueError('Input must match the prepared, hash-locked 48-case blind fixture.')
rows = json.loads(source)
excluded = set(policy['selections']['24']['caseIds']) | set(policy['selections']['6']['caseIds'])
salt = 'noether-proof-grader:trojan-h:v2-holdout:'
frames = [('v2a', 'd190b89f02d3de19411d80d65da92617c01d119628287a016c4cd0d34ca45d62'),
          ('v2b', 'e4fcd0e13129daf2f92995f561f5b475c6d3e0ac0c38f3b6ec4ac59a544a5532')]
args.destination.mkdir(parents=True, exist_ok=True)
for name, expected in frames:
    ranked = sorted((row for row in rows if row['id'] not in excluded),
                    key=lambda row: (sha256((salt + row['id']).encode()).hexdigest(), row['id']))
    chosen, problems = [], set()
    for row in ranked:
        if row['question']['id'] in problems:
            continue
        chosen.append(row)
        problems.add(row['question']['id'])
        if len(chosen) == 3:
            break
    encoded = (json.dumps(chosen, ensure_ascii=False, indent=2) + '\n').encode()
    if sha256(encoded).hexdigest() != expected:
        raise ValueError('Selection differs from preregistration.')
    (args.destination / f'{name}-fixtures.json').write_bytes(encoded)
    excluded.update(row['id'] for row in chosen)
    print(name, expected, [row['id'] for row in chosen])
