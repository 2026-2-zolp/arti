# 🤝 GitHub 협업 도구 안내

[← 메인 안내로](../README.md)

이 폴더에는 **Issue와 PR을 작성할 때 자동으로 보여 주는 템플릿**이 있습니다.

## 어떻게 쓰나요?

```text
개발할 일 생김 → Issues에서 작업 등록
    ↓
자신의 dev/이름 브랜치에서 작업
    ↓
커밋 및 push
    ↓
Pull Request 생성
    ↓
PR 템플릿대로 변경 내용·테스트 결과 작성
    ↓
서로 검토 → main 병합
```

| 파일 | 목적 |
| --- | --- |
| [PULL_REQUEST_TEMPLATE.md](PULL_REQUEST_TEMPLATE.md) | PR 변경사항·검증 체크리스트 |
| [ISSUE_TEMPLATE/feature_request.md](ISSUE_TEMPLATE/feature_request.md) | 기능 작업 등록 |
| [ISSUE_TEMPLATE/bug_report.md](ISSUE_TEMPLATE/bug_report.md) | 버그 재현·기대 결과 기록 |

**이곳에는 아직 GitHub Actions CI 워크플로가 없습니다.** 실제 앱 실행/테스트 명령이 정해지면 추가할 예정입니다.

**주의:** 이 폴더는 `arti` 저장소 내부의 PR/Issue 설정이며, GitHub 조직 메인 화면을 꾸미는 별도 `.github` 저장소와는 다릅니다.
