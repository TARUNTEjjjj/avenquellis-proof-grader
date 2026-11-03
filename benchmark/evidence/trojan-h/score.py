"""Compare frozen model suggestions with human references. Abstentions stay unscored."""
import argparse
import json
from collections import Counter
from pathlib import Path
from statistics import mean


def by_id(records):
    index = {record['id']: record for record in records}
    if len(index) != len(records):
        raise ValueError('Duplicate record IDs')
    return index


def report(targets, predictions):
    gold = by_id(targets)
    guessed = by_id(predictions)
    if not gold or gold.keys() != guessed.keys():
        raise ValueError('Expected exactly one prediction or explicit abstention for every target')
    cases = []
    for identifier, target in gold.items():
        guess = guessed[identifier]
        reference = target['score']
        suggestion = guess['suggestedScore']
        if target['source'] != 'human' or target['maxMarks'] != 7 or type(reference) is not int or not 0 <= reference <= 7:
            raise ValueError(f'Invalid human label at {identifier}')
        if suggestion is not None and (type(suggestion) is not int or not 0 <= suggestion <= 7):
            raise ValueError(f'Invalid suggested mark at {identifier}')
        cases.append({'id': identifier, 'problem': target['problem'], 'humanMark': reference,
                      'suggestedScore': suggestion, 'reviewReason': guess['reviewReason'],
                      'reviewerScores': guess['reviewerScores'], 'criterionScores': guess.get('criterionScores'),
                      'failureCodes': guess.get('failureCodes'), 'milliseconds': guess.get('milliseconds')})
    errors = [r['suggestedScore'] - r['humanMark'] for r in cases if r['suggestedScore'] is not None]
    metrics = None
    if errors:
        metrics = {'exactCount': errors.count(0), 'exactRate': mean(e == 0 for e in errors),
                   'withinOneCount': sum(abs(e) <= 1 for e in errors), 'withinOneRate': mean(abs(e) <= 1 for e in errors),
                   'meanAbsoluteError': mean(abs(e) for e in errors), 'meanSignedError': mean(errors),
                   'overCount': sum(e > 0 for e in errors), 'underCount': sum(e < 0 for e in errors),
                   'maximumAbsoluteError': max(abs(e) for e in errors)}
    return {'maximumMarks': 7, 'total': len(cases), 'scored': len(errors), 'abstained': len(cases) - len(errors),
            'coverage': len(errors) / len(cases), 'onScored': metrics,
            'reasons': dict(sorted(Counter(r['reviewReason'] for r in cases).items())), 'cases': cases}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('targets', type=Path)
    parser.add_argument('predictions', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    predictions = json.loads(args.predictions.read_text())
    if isinstance(predictions, dict):
        predictions = predictions.get('cases', predictions.get('predictions'))
    result = report(json.loads(args.targets.read_text()), predictions)
    contents = json.dumps(result, indent=2) + '\n'
    if args.out:
        args.out.write_text(contents)
    else:
        print(contents, end='')
