# 📚 Docs — 처음 읽을 문서 길잡이

[← 메인 안내로](../README.md)

문서가 많아 보여도 **전부 처음부터 읽을 필요는 없습니다.** 아래 순서로 필요한 부분만 보세요.

## 무엇부터 읽으면 되나요?

| 상황 | 먼저 읽을 문서 | 확인할 내용 |
| --- | --- | --- |
| 방금 팀에 초대됨 | [TEAM_ONBOARDING.md](TEAM_ONBOARDING.md) | 내 브랜치 선택, Git 기본 작업, PR |
| GitHub 협업 방식이 헷갈림 | [WORKFLOW.md](WORKFLOW.md) | 개인 브랜치와 `main` 관계 |
| 코드 작성·커밋·리뷰 규칙 확인 | [CONTRIBUTING.md](CONTRIBUTING.md) | 한국어 커밋, PR, 병합 주의사항 |
| 어디까지 만들어야 하는지 확인 | [PROJECT_SCOPE.md](PROJECT_SCOPE.md) | P0/P1, 확정·미확정 범위 |
| 프론트·백엔드 데이터 연결 | [API_DECISIONS.md](API_DECISIONS.md) | 아직 합의가 필요한 API·ID |
| GitHub 조직 소개 준비 | [ORG_PROFILE_DRAFT.md](ORG_PROFILE_DRAFT.md) | 아직 실제 조직 프로필에 반영되지 않은 초안 |

## 개발 코드가 있는 곳

```text
frontend/  사용자 화면
backend/   API·추천 로직
data/      작품 데이터·출처·검수
scripts/   자료 수집·변환
docs/      개발 문서와 결정사항
.github/   Issue/PR 양식
```

각 폴더에도 README가 있습니다. **실제 기능을 추가하면 해당 폴더의 실행법·의존성·검증 방법도 함께 갱신**해 주세요.

## Notion과 GitHub의 역할
- **Notion:** 전체 회의·기획 합의·일정·담당·조사 근거
- **GitHub docs:** 코드 작업에 바로 필요한 안내·인터페이스·변경 규칙
- 상충되는 중요한 판단은 팀 회의에서 확정해 Notion과 코드 문서 양쪽에 반영합니다.

> 이 문서들은 팀 개발을 돕기 위한 초기 안내입니다. [ARTI Notion](https://app.notion.com/p/26-2-ARTI-a3534713f16782789905811787871032)에 없는 새로운 기술 선택을 이 문서만으로 확정하지 않습니다.
