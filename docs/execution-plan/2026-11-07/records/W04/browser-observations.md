# W04 실제 React→Django→Postgres 관측

2026-11-08 KST, CUA IAB 실제브라우저. UI5178→Compose api8000→PostgreSQL17.11, 외부LLM/실전시자료/사용자개인정보없음.

1. 루트목록에running인“ARTI개발검증전시”만표시. 비공개검증전시는없음.
2. 전시진입→비회원→기존U05다섯독립쌍에서01/03/05/07/09선택→풍경태그→30분→U08추천3점(01/03/05). react-recommendation-ax.txt/png 저장. 실제img naturalWidth=1이며 /api/uploads/fixture-public.png를읽었다.
3. 지도→작품원문에“실제전시자료가아닌개발검증용원문”표시. suggested요약/가이드가노출되지않음. react-artwork-ax.txt. 시간·취향UI를새로만들지않았다. 원본profile연결은W05라서이번경로는기존tastes[]계약검증이다.
4. 명시적으로bootstrap한시험관리자로로그인. 관리자작품목록은13건이며pending11번/비공개전시13번도보임. 일반공개목록과분리된데이터다. API서버로그의/admin/exhibitions,/admin/artworks 요청과연결한다.
5. fixture-art11미검수상세에서보호이미지표시. admin-private-ax.txt/png, admin-private-image.json의src=blob:localhost·complete=true·naturalWidth1확인. 원본파일명URL에token이없다. 공개파일404는PostgresAPI검사와교차확인한다.
6. /admin/map?exhibition=fixture-draft에서비공개전시도면표시. AX에선택전시/평면도사용1×1px, SVG image href가blob URL임을읽었다. admin-draft-plan-ax.txt/png. 도면저장/실제동선최적화검증은아니다.
7. 브라우저console warn/error관측은[]였다. 이미지/도면은전송·권한검증을위한1픽셀자료이며시각품질·실물작품추천효과의근거로사용하지않는다.

이후검증단의경미한빠른URL전환정리와Django관리자로그인안내를보완했다. 해당변경은타입/빌드와코드독립검토로확인하고위전체여정을새로운사용자시험으로반복/과장하지않는다.
