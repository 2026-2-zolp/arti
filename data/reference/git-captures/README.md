# Git 캡처 자료 참조 사본

이 폴더는 실제 전시의 검수 완료 데이터가 아니다. capture-descriptions.json은 기준 커밋 ae0e58ebc338c17da6d4d17616fd802f03ba3bb6의 backend/scripts/capture-descriptions.json Git blob을 바이트 그대로 추출한 **미검수 AI 초안**이다. checkedAt=null을 그대로 보존했다. 기존 원본은 이동·삭제·수정하지 않았다.

provenance.json은 원경로·전체 commit SHA·Git blob OID·참조사본 SHA256/바이트 수와 기존 자료의 해시 목록을 구분해 기록한다. JSON 자산 해시는 정렬한 compact UTF-8 의미값, CSV는 UTF-8/LF, 이미지는 원바이트 기준이다. 참조사본 자체는 -text로 줄바꿈까지 보존한다. 이미지와 평가 라벨은 목적에 맞게 ai-service/evaluation에 유지하며 중복 복사하지 않는다.

현재 exporter는 여기의 사본만 읽으므로 backend 디렉터리나 Node/Express 설치 없이 캡처 bundle을 만들 수 있다. 참조사본을 임의로 검수본으로 수정하지 않는다. 실제 검수 자료는 별도의 인수·버전 절차로 다룬다. 갱신할 필요가 생기면 provenance/기준 Git/검사와 함께 명시적으로 변경한다.

자료 집합: 캡처40점·해설40건/취향 라벨, WikiArt 이미지 파일79개, 별도 감정 평가 예시11건. WikiArt79개에 작품 메타데이터/정답 라벨이 모두 대응한다거나 유영국 실제 출품작이라고 판단하지 않는다. 라벨CSV와 파일 형식 점검은 사실성·이미지 권리·사람 검수를 대신하지 않는다.

실행은 저장소 루트에서 `python scripts/git_materials.py`, `python -m unittest discover -s scripts/tests -v`. DB·원본 파일을 변경하거나 외부 URL·모델을 호출하지 않는다.
