"""Build a paired Luna evaluator sheet from recorded synthetic A-04 runs."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from random import SystemRandom

from prepare_draft_model_comparison import FIXTURES


TASKS = {'summary': '쉬운 요약', 'guide': '관람가이드'}


def paired_runs(record, manifest):
    inputs = {case['id']: case for case in manifest['cases']}
    for identifier, case in inputs.items():
        if record['cases'][identifier]['manifest'] != case:
            raise ValueError(f'{identifier}: input versions or hashes changed')
        for field in ('source', 'image'):
            pin = case[field]
            if sha256((FIXTURES / pin['file']).read_bytes()).hexdigest() != pin['sha256']:
                raise ValueError(f'{identifier}: {field} file no longer matches its hash')

    expected = {(case, task, repeat, use_image) for case in inputs for task in TASKS
                for repeat in (1, 2) for use_image in (False, True)}
    rows = {}
    for row in record['results']:
        key = row['caseId'], row['task'], row['repeat'], row['useImage']
        if type(row['repeat']) is not int or type(row['useImage']) is not bool or key not in expected or key in rows:
            raise ValueError(f'Unexpected or duplicate trial {key}')
        rows[key] = row
    if rows.keys() != expected:
        raise ValueError(f'Missing {len(expected - rows.keys())} observations')
    return rows


def build(record, manifest):
    rows = paired_runs(record, manifest)
    lines = ['# Luna L01~L03 가림 평가 답안', '',
             '각 쌍의 X와 Y를 따로 채점한다. 같은 작품의 원문과 도판을 함께 확인한다.',
             '근거 정확성 0~2점과 작업 적합성 0~2점을 적고, 문제 문장과 근거를 짧게 남긴다.',
             '맞지 않는 색·위치·형태나 근거 없는 질문·힌트의 전제가 있으면 실패로 표시한다.',
             '두 자료가 다르게 보이면 차이를 알리거나 한쪽 위치를 전제하지 않았는지 살핀다.',
             '조건을 추정하더라도 답안 자체를 채점한다. 생성문은 저장한 문구를 그대로 담았다.', '',
             '| 시행 ID | X 근거·적합성 / 판정 | Y 근거·적합성 / 판정 | 확인한 문장 또는 도판 근거 |',
             '| --- | --- | --- | --- |']
    hidden = {}
    for case in manifest['cases']:
        for task in TASKS:
            for repeat in (1, 2):
                lines.append(f"| {case['id']}-{task}-{repeat} |  |  |  |")

    pairs_per_task = len(manifest['cases']) * 2
    x_images = {task: [False, True] * (pairs_per_task // 2) for task in TASKS}
    for values in x_images.values():
        SystemRandom().shuffle(values)
    for case in manifest['cases']:
        case_id = case['id']
        source, image = (case[field]['file'] for field in ('source', 'image'))
        lines.extend(['', f'## {case_id}', '', f'[원문](luna-fixtures/{source}) · [도판](luna-fixtures/{image})'])
        for task, label in TASKS.items():
            for repeat in (1, 2):
                trial = f'{case_id}-{task}-{repeat}'
                x_mode = x_images[task].pop()
                hidden[trial] = {}
                lines.extend(['', f'### {trial} · {label}', ''])
                for side, use_image in (('X', x_mode), ('Y', not x_mode)):
                    row = rows[case_id, task, repeat, use_image]
                    hidden[trial][side] = {'useImage': use_image, 'requestId': row['requestId']}
                    output = row.get('output')
                    lines.extend([f'**{side}**', ''])
                    if output is None:
                        lines.extend(['생성 실패', ''])
                    else:
                        lines.extend(['```json', json.dumps(output, ensure_ascii=False, indent=2), '```', ''])
    return '\n'.join(lines), hidden


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('record', type=Path)
    parser.add_argument('--review', required=True, type=Path)
    parser.add_argument('--private-map', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.review.exists() or args.private_map.exists() or args.review.resolve() == args.private_map.resolve():
            raise ValueError('Provide distinct output paths that do not exist yet')
        record = json.loads(args.record.read_text(encoding='utf-8-sig'))
        manifest = json.loads((FIXTURES / 'manifest.json').read_text(encoding='utf-8'))
        sheet, hidden = build(record, manifest)
        args.private_map.write_text(json.dumps(hidden, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
        args.review.write_text(sheet, encoding='utf-8', newline='\n')
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print(f'Prepared {len(hidden)} X/Y pairs. Keep the condition mapping private.')


if __name__ == '__main__':
    main()
