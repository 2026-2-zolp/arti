"""Check Markdown replies against the archived docent answers and scoring rubric."""

import argparse
from collections import Counter
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
import re


ARCHIVE = Path(__file__).resolve().parents[1] / 'docs/execution-plan/2026-11-07/records/docent-baseline-2026-11-09'
ANSWERS_SHA256 = '8ed8834e2f8294edbe5525b0f753863b101385d4f4df1f083203e66e129d7318'
SCORES = ('근거', '요청 반영', '연속성', '명료성')
COLUMNS = ('사례', *SCORES, '평균', '필수 행동', '중대 위반', '판정', '판단 문장과 근거')
REVIEWER = '검수자 별칭'
REVIEWED_ON = '작성일'
EXPOSURE = '기존 판정 또는 다른 검수자 의견 열람 여부'
ANSWER_HASH = '평가 자료 SHA-256'
EXPOSURE_VALUES = {'미열람', '열람', '모름'}
DECISIONS = {'통과', '수정', '실패', '보류'}
EMPTY = {'', '-', '–', '—', '해당 없음'}


def read_archive():
    raw = (ARCHIVE / 'targeted-results.json').read_bytes().replace(b'\r\n', b'\n')
    if sha256(raw).hexdigest() != ANSWERS_SHA256:
        raise ValueError('저장 답변 원본의 SHA-256이 달라요.')
    results = json.loads(raw)
    protocol = (ARCHIVE / 'protocol.json').read_bytes().replace(b'\r\n', b'\n')
    protocol_hash = sha256(protocol).hexdigest()
    if protocol_hash != results['protocolSha256'] or protocol_hash != (ARCHIVE / 'protocol.sha256').read_text().strip():
        raise ValueError('저장 답변과 질문 프로토콜의 SHA-256이 맞지 않아요.')
    answers = {row['id']: row['value']['answer'] for row in results['outputs']}
    return {
        'answersSha256': ANSWERS_SHA256,
        'protocolSha256': protocol_hash,
        'promptSourceSha256': results['promptSourceSha256'],
    }, answers


def cells(line):
    body = line.removeprefix('|').removesuffix('|')
    return tuple(cell.strip().replace(r'\|', '|') for cell in re.split(r'(?<!\\)\|', body))


def parse_reply(text):
    metadata, rows, issues = {}, {}, []
    lines = text.splitlines()
    start = next((i + 1 for i, line in enumerate(lines) if line.strip() == '## 제출표'), 0)
    found_header = False
    for number, line in enumerate(lines[start:], start + 1):
        line = line.strip()
        if line.startswith('## '):
            break
        if line.startswith('- ') and '·' in line and not found_header:
            key, _, value = line[2:].partition('·')
            key = key.strip()
            if key in metadata:
                issues.append({'field': key, 'issue': 'duplicate-metadata', 'line': number})
            metadata[key] = value.strip().strip('`')
        if not line.startswith('|'):
            continue
        parts = cells(line)
        if not found_header:
            found_header = parts == COLUMNS
        elif not all(re.fullmatch(r':?-{3,}:?', part) for part in parts):
            rows.setdefault(parts[0], []).append((number, parts))
    if not found_header:
        issues.append({'issue': 'submission-table-missing'})
    return metadata, rows, issues


def check_metadata(metadata):
    issues = []
    if metadata.get(REVIEWER, '') in EMPTY:
        issues.append({'field': REVIEWER, 'issue': 'missing'})
    value = metadata.get(REVIEWED_ON, '')
    try:
        valid_date = date.fromisoformat(value).isoformat() == value
    except ValueError:
        valid_date = False
    if not valid_date:
        issues.append({'field': REVIEWED_ON, 'issue': 'expected-iso-date'})
    if metadata.get(EXPOSURE) not in EXPOSURE_VALUES:
        issues.append({'field': EXPOSURE, 'issue': 'exposure-unreported'})
    if metadata.get(ANSWER_HASH, '').lower() != ANSWERS_SHA256:
        issues.append({'field': ANSWER_HASH, 'issue': 'archive-hash-missing-or-different'})
    return issues


def normal(text):
    return ' '.join(text.split())


def check_row(case, answer, parts):
    if len(parts) != len(COLUMNS):
        return {'issues': ['unexpected-column-count']}

    row = dict(zip(COLUMNS, parts))
    decision, behavior, critical = (row[key] for key in ('판정', '필수 행동', '중대 위반'))
    on_hold = decision == '보류'
    applicable = () if case.endswith('-first') else SCORES if case.endswith('-followup') else ('근거', '명료성')
    scores, issues = {}, []
    for key in SCORES:
        value = row[key]
        if key in applicable and value in {'0', '1', '2'}:
            scores[key] = int(value)
        elif key in applicable and (not on_hold or value not in EMPTY):
            issues.append(f'{key}-score-required-0-to-2')
        elif key not in applicable and value not in EMPTY:
            issues.append(f'{key}-not-applicable')

    mean = sum(scores.values()) / len(applicable) if applicable and len(scores) == len(applicable) else None
    entered_mean = row['평균']
    if entered_mean not in EMPTY:
        valid_mean_format = re.fullmatch(r'[0-2](?:\.\d+)?(?:/2)?', entered_mean)
        if not valid_mean_format or mean is None or float(entered_mean.removesuffix('/2')) != mean:
            issues.append('mean-mismatch')

    if decision not in DECISIONS:
        issues.append('decision-required')
    if behavior not in {'충족', '미충족'} and (not on_hold or behavior not in EMPTY | {'보류'}):
        issues.append('required-behavior-unreported')
    if critical not in {'있음', '없음'} and (not on_hold or critical not in EMPTY | {'보류'}):
        issues.append('critical-violation-unreported')
    if critical == '있음' and decision != '실패':
        issues.append('decision-mismatch')
    elif not on_hold and critical == '없음' and behavior in {'충족', '미충족'} and (not applicable or mean is not None):
        expected = '수정' if behavior == '미충족' or (mean is not None and mean < 1.5) else '통과'
        if decision in DECISIONS and decision != expected:
            issues.append('decision-mismatch')

    quote, arrow, evidence = row['판단 문장과 근거'].partition('→')
    quote = quote.strip().strip('"“”‘’`').strip()
    if not arrow or evidence.strip() in EMPTY:
        issues.append('missing-evidence-or-needed-material')
    if quote in EMPTY:
        if not on_hold:
            issues.append('missing-answer-excerpt')
    elif normal(quote) not in normal(answer):
        issues.append('answer-excerpt-not-found')

    return {'decision': decision, 'requiredBehavior': behavior, 'criticalViolation': critical,
            'scores': scores, 'mean': mean, 'issues': issues}


def inspect_reply(text, answers):
    metadata, rows, issues = parse_reply(text)
    issues.extend(check_metadata(metadata))
    for case, items in rows.items():
        if case not in answers:
            issues.extend({'issue': 'unknown-case', 'line': line} for line, _ in items)
    cases = {}
    for case, answer in answers.items():
        items = rows.get(case, [])
        if len(items) == 1:
            line, parts = items[0]
            cases[case] = {'line': line, **check_row(case, answer, parts)}
        else:
            cases[case] = {'issues': ['duplicate-case' if items else 'missing-case'], 'lines': [line for line, _ in items]}
    return {'reviewer': metadata.get(REVIEWER), 'reviewedOn': metadata.get(REVIEWED_ON),
            'priorReviewExposure': metadata.get(EXPOSURE), 'issues': issues, 'cases': cases}


def disagreement(replies, case):
    valid = [reply for reply in replies if not reply['issues'] and not reply['cases'][case]['issues']]
    decided = [reply for reply in valid if reply['cases'][case]['decision'] != '보류']
    rows = [reply['cases'][case] for reply in decided]
    return {
        'recordableReplies': len(valid),
        'held': len(valid) - len(decided),
        'unexposedReportedDecisions': sum(reply['priorReviewExposure'] == '미열람' for reply in decided),
        'decisionCounts': dict(Counter(row['decision'] for row in rows)),
        'differentDecisions': len({row['decision'] for row in rows}) > 1,
        'differentRequiredBehavior': len({row['requiredBehavior'] for row in rows}) > 1,
        'differentCriticalViolation': len({row['criticalViolation'] for row in rows}) > 1,
        'differentScores': [field for field in SCORES if len({row['scores'].get(field) for row in rows}) > 1],
    }


def report(refs, answers, text_replies):
    replies = [{'reply': index, **inspect_reply(text, answers)} for index, text in enumerate(text_replies, 1)]
    counts = Counter(reply['reviewer'].casefold() for reply in replies if reply['reviewer'] not in EMPTY | {None})
    for reply in replies:
        if reply['reviewer'] and counts[reply['reviewer'].casefold()] > 1:
            reply['issues'].append({'field': REVIEWER, 'issue': 'duplicate-reviewer'})
    exposures = [r['priorReviewExposure'] if r['priorReviewExposure'] in EXPOSURE_VALUES else '미기록' for r in replies]
    return {
        'archive': refs, 'caseCount': len(answers), 'replyCount': len(replies),
        'priorReviewExposureCounts': dict(Counter(exposures)),
        'caseSummary': {case: disagreement(replies, case) for case in answers},
        'replies': replies,
        'scope': 'receipt precheck; human decisions preserved; publication and gate decisions unchanged',
    }


def main():
    parser = argparse.ArgumentParser(description='저장된 도슨트 답변 12건의 팀 회신을 확인합니다.')
    parser.add_argument('reply', nargs='+', type=Path, help='제출표를 채운 UTF-8 Markdown 파일')
    args = parser.parse_args()
    try:
        result = report(*read_archive(), [path.read_text(encoding='utf-8-sig') for path in args.reply])
    except (OSError, ValueError) as error:
        parser.exit(2, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
