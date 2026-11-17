"""Check coverage and grading of a blind Luna L01–L03 score sheet."""
import argparse
import csv
import json
from pathlib import Path

from prepare_luna_vision_review import FIXTURES, TASKS


COLUMNS = (
    '시행 ID', '답안', '근거 정확성 0~2', '작업 적합성 0~2',
    '판정', '문제 구절', '원문 또는 도판 근거',
)
VERDICTS = {'초안 활용 가능': 'usable', '수정': 'revise', '실패': 'failed', '보류': 'hold'}
POINTS = {'0', '1', '2'}


def grade(scores, decision, quote, evidence, row):
    if not any((*scores, decision, quote, evidence)):
        return 'unreviewed'
    verdict = VERDICTS.get(decision)
    if verdict is None:
        raise ValueError(f'Row {row}: enter a verdict from the scoring guide.')
    if not evidence:
        raise ValueError(f'Row {row}: enter the source or image evidence for this verdict.')
    if verdict == 'hold' and not any(scores):
        return verdict
    if not all(score in POINTS for score in scores):
        raise ValueError(f'Row {row}: both scores must be integers from 0 to 2.')
    if verdict == 'failed' and not quote:
        raise ValueError(f'Row {row}: name the issue in the answer or the missing output.')
    if verdict in ('usable', 'revise'):
        expected = 'usable' if sum(map(int, scores)) >= 3 else 'revise'
        if verdict != expected:
            raise ValueError(f'Row {row}: the verdict disagrees with the scoring threshold.')
    return verdict


def check_review(stream, manifest):
    trials = [f"{case['id']}-{task}-{repeat}" for case in manifest['cases']
              for task in TASKS for repeat in (1, 2)]
    scores = {trial: dict.fromkeys(('X', 'Y'), 'unreviewed') for trial in trials}
    reader = csv.reader(stream, strict=True)
    if tuple(next(reader, ())) != COLUMNS:
        raise ValueError('Use the columns in Luna_응답표.csv in their original order.')
    seen = set()
    for cells in reader:
        row = reader.line_num
        if not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(COLUMNS):
            raise ValueError(f'Row {row}: expected {len(COLUMNS)} columns.')
        trial, side, grounding, fit, decision, quote, evidence = (cell.strip() for cell in cells)
        if trial not in scores or side not in ('X', 'Y') or (trial, side) in seen:
            raise ValueError(f'Row {row}: unknown or duplicate trial ID and X/Y label.')
        seen.add((trial, side))
        scores[trial][side] = grade((grounding, fit), decision, quote, evidence, row)

    counts = dict.fromkeys((*VERDICTS.values(), 'unreviewed'), 0)
    pending = []
    for trial, answers in scores.items():
        for verdict in answers.values():
            counts[verdict] += 1
        sides = [side for side, verdict in answers.items() if verdict in ('unreviewed', 'hold')]
        if sides:
            pending.append({'trialId': trial, 'sides': sides})
    return {'completePairs': len(trials) - len(pending), 'totalPairs': len(trials),
            'byVerdict': counts, 'pendingPairs': pending}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review', type=Path, help='One reviewer’s Luna_응답표.csv')
    args = parser.parse_args()
    try:
        manifest = json.loads((FIXTURES / 'manifest.json').read_text(encoding='utf-8'))
        with args.review.open(encoding='utf-8-sig', newline='') as stream:
            result = check_review(stream, manifest)
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(2, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
