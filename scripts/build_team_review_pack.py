# 팀에 한 번에 전달할 검수 ZIP과 최신 인수 초안 기반 회신 자료를 생성합니다.
import hashlib
import json
from zipfile import ZIP_DEFLATED, ZipFile

from build_yoo_core3_review import main as build_core3
from survey_blind_review import build_pack
from yoo_labels import ROOT


def main():
    output = ROOT / 'data/private/team-review-20261111'
    if output.exists():
        raise ValueError('새 출력 폴더가 필요합니다. 기존 전달본과 응답을 보존하세요.')
    output.mkdir(parents=True)
    build_core3()
    matrix = json.loads((ROOT / 'docs/review/taste-survey-2026-11-10/matrix.json').read_text(encoding='utf-8'))
    build_pack(matrix, output / 'candidate-source')
    review = ROOT / 'docs/review/yoo-core3-2026-11-11'
    files = {'먼저 확인할 것.md': (review / '먼저 확인할 것.md').read_bytes()}
    with ZipFile(ROOT / 'data/private/independent-review-20261111/core3-blind.zip') as core:
        for name in core.namelist():
            if name != 'reviewer.md':
                files['01_태그/' + name] = core.read(name)
    for variant in ('V1', 'V2'):
        files[f'02_후보비교/{variant}.html'] = (output / 'candidate-source' / f'{variant}.html').read_bytes()

    intake = json.loads((ROOT / 'data/intake/2026-11-09-yoo-youngkuk/core3-manifest.json').read_text(encoding='utf-8'))
    content = [
        '# 핵심 3점 콘텐츠 검토',
        '',
        '01·02 응답을 저장한 다음 읽어 주세요. 아래 내용은 현재 인수 manifest의 팀 작성 검수 전 초안입니다.',
        '각 소장품 링크를 열어 작품명·연도·형태와 구도를 비교하고, 이미지·아래 설명에서 판단 가능한 항목을 회신양식에 적어 주세요.',
        '공식 해설과 실제 캡처 출처, 개별 사용 조건은 추가 확인이 필요합니다. 링크 접속이 안 되면 그 사실을 적고 판단을 보류해 주세요.',
        '',
    ]
    form = [
        '# 팀 검수 회신', '', '- 별칭 / 작성일', '- 완료한 단계 / V1 또는 V2',
        '- 모델 결과·기존 답·작품을 미리 본 내용',
        '- 단계별 소요 시간 / 사용 기기·브라우저 / 막힌 부분', '',
    ]
    for index, row in enumerate(intake['items'], start=1):
        content.extend([
            f'## {row["id"]} · {row["title"]}({row["year"]})', '',
            f'![검토 이미지](../01_태그/images/image-{index}.png)', '',
            f'식별 참고 — [{row["source"]}]({row["referenceUrl"]})', '',
            '### 작품해설 초안', '', row['description'], '',
            '### 쉬운 요약 초안', '', row['summary'], '',
            '### 관람가이드 초안', '', row['guide']['intro'], '',
            *[f'- 질문 — {question}' for question in row['guide']['questions']],
            *[f'- 힌트 — {hint}' for hint in row['guide']['hints']], '',
            '검토할 점은 이미지와 관찰 문장의 일치, 이해하기 쉬운 요약, 답을 강요하지 않는 질문, 질문에 도움이 되는 힌트입니다.',
            '도슨트가 이 질문과 본인의 관찰을 이어받는다고 가정했을 때 더 필요한 정보도 적어 주세요.', '',
        ])
        form.extend([
            f'## {row["id"]}', '',
            '| 항목 | 확인 / 수정 / 판단 보류 | 이유·수정안·근거 |',
            '| --- | --- | --- |',
            *[f'| {item} | | |' for item in ('이미지와 작품 식별', '작품해설', '쉬운 요약', '질문·힌트', '캡처 출처·사용 근거')],
            '', '- 실제 캡처 URL / 사이트 / 수집 맥락', '- 추가로 필요한 자료', '',
        ])
    form.extend(['## 기타', '', '- 취향 조사 후보의 대비·화질·질문 개선 의견', '- 다른 의견', ''])
    files['03_콘텐츠/검토할 내용.md'] = '\n'.join(content).encode('utf-8')
    files['03_콘텐츠/회신양식.md'] = '\n'.join(form).encode('utf-8')
    archive = output / 'ARTI_팀검수_20261111.zip'
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as bundle:
        for name, data in files.items():
            bundle.writestr(name, data)
    receipt = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    (output / 'package-hashes.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(archive)


if __name__ == '__main__':
    main()
