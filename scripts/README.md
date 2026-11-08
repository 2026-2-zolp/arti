# 🔧 Scripts — 자료 수집부터 데이터 준비까지

[← 메인 안내로](../README.md)

**역할:** 공식 전시·작품 자료를 확인하고, [data/](../data/)의 검수 기준에 맞게 구조화하는 스크립트를 모읍니다.

## 수집 파이프라인

```text
1. 공식 원자료 URL 선정
       ↓
2. 수집 허용 범위·저작권·사용 조건 확인
       ↓
3. 원본 구조 파악 및 필요한 정보 추출
       ↓
4. 필드명·작품 ID·출처 정리
       ↓
5. 검증(전시 소속·이미지·해설·중복)
       ↓
6. data/에 반영할 결과 생성
```

## 스크립트 추가 시 꼭 적을 내용

각 스크립트의 주석 또는 문서에 **입력(공식 출처), 출력(파일/형식), 실행 방법, 의존성, 실패 시 처리, 확인 일자**를 함께 남깁니다.

수집 자동화보다 먼저 **합법적 재사용·근거 추적**을 확인합니다. 사이트에 접근 가능하다고 해서 해당 데이터를 무조건 재배포할 수 있는 것은 아닙니다.

## 첫 작업 우선순위
- 전시 후보 중 먼저 구현할 대상 선정
- 작품 3~5점에 필요한 원본 링크 정리
- 수작업 또는 스크립트로 동일 형식의 데이터 생성
- 출처 검수 완료 후 [현재 Django API](../backend-django/README.md)에 계약에 맞춰 전달

## 현재 실행 가능한 도구

외부 사이트 자동 수집기는 아직 없다. 기존 Git 자료의 점검·복원은 다음 도구를 사용한다.

```powershell
python scripts/git_materials.py
python -m unittest discover -s scripts/tests -v
python scripts/export_git_captures.py data/private/captures-new
```

export 목적지는 매번 새 디렉터리를 지정한다. 기존 디렉터리·원본 영역에는 덮어쓰지 않으며 검사를 통과하기 전 출력하지 않는다. DB가 아닌 bundle을 만들고, Django의 import_capture_bundle은 별도로 명시 실행한다. stdout 점검 결과를 보존할 수 있으며 자동 승인·좌표 부여·운영 시드를 실행하지 않는다.

해설 입력은 [원본 추적 가능한 참조 사본](../data/reference/git-captures/README.md)이다. Express/Node·legacy backend 폴더를 요구하지 않는다. 모델 평가 이미지·라벨은 ai-service/evaluation에 남겨 두며, 과거 backend 시드와 W03 결함 재현은 역사적 비교용이다. 기존 bundle의 원문 의미·40개ID·이미지 해시는 유지한다. 유영국 실제 자료와 로컬 고유 DB/업로드 인수는 별도다.
