"""
팀원 태그 라벨 집계 — 다수결 정답 · 사람끼리 일치도 · 갈린 그림 목록

실행 (ai-service 폴더에서):
    python -m evaluation.team_tags            # 집계만 (tag_eval_set.json은 그대로)
    python -m evaluation.team_tags --apply    # 다수결 정답으로 tag_eval_set.json 의 primary·expected 교체

입력: evaluation/labeling/responses/ 의 CSV (2명 이상)
  - labels_<이름>.csv : labeling.html 에서 내려받은 파일
  - 구글 폼 응답 시트를 CSV로 내려받은 파일 (labeling/make_google_form.gs 로 만든 폼, 이름은 자유)
출력:
  - evaluation/results/team_tags_report.md        태그별 일치도(Fleiss' kappa)와 다수결 결과
  - evaluation/results/team_tags_disagreements.csv 의견이 갈린 칸 (회의 4단계에서 다시 볼 목록)

다수결: 평가자 절반 초과가 O면 O. 동점(짝수 인원)이면 기존 정답(개발자 판단)을 따르고 갈린 목록에 표시한다.
표준 라이브러리만 써서 모델·pandas 없이도 돈다.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

from app.tags import TAG_KEYS, TAGS

EVAL_DIR = Path(__file__).parent
RESP_DIR = EVAL_DIR / "labeling" / "responses"
SET_FILE = EVAL_DIR / "tag_eval_set.json"
RESULTS = EVAL_DIR / "results"
KO = {t["key"]: t["ko"] for t in TAGS}


KO2KEY = {t["ko"]: t["key"] for t in TAGS}
FORM_ID = re.compile(r"^\[(\d+)\] (해당하는 태그|대표 태그|확신 없음|메모)")


def read_google_form(path: Path) -> dict[str, dict[str, dict]]:
    """구글 폼 응답 시트(CSV) — 한 줄 = 평가자 1명, 질문 제목 앞의 [01] 번호로 작품을 찾는다 (make_google_form.gs).
    같은 이름이 여러 번 제출했으면 마지막 응답을 쓴다."""
    out: dict[str, dict[str, dict]] = {}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            rater = (r.get("이름") or "").strip()
            if not rater:
                continue
            answers: dict[str, dict] = {}
            for col, val in r.items():
                m = FORM_ID.match(col or "")
                if m:
                    answers.setdefault(m.group(1).zfill(2), {})[m.group(2)] = (val or "").strip()
            out[rater] = {}
            for i, a in answers.items():
                primary = KO2KEY.get(a.get("대표 태그", ""))
                if not primary:
                    continue
                tags = {KO2KEY[t.strip()] for t in a.get("해당하는 태그", "").split(",") if t.strip() in KO2KEY}
                out[rater][i] = {"tags": tags | {primary}, "primary": primary,
                                 "unsure": bool(a.get("확신 없음")), "note": a.get("메모", "")}
    return out


def read_labels(resp_dir: Path = RESP_DIR) -> dict[str, dict[str, dict]]:
    """{평가자: {작품 id: {"tags": set, "primary": str, "unsure": bool, "note": str}}} — 빈칸(안 한 그림)은 뺀다
    labels_<이름>.csv (labeling.html) 와 구글 폼 응답 CSV(그 밖의 .csv, 첫 줄에 「이름」 열) 둘 다 읽는다."""
    out: dict[str, dict[str, dict]] = {}
    for f in sorted(resp_dir.glob("*.csv")):
        if f.name.startswith("labels_"):
            continue
        with f.open(encoding="utf-8-sig", newline="") as fh:
            head = next(csv.reader(fh), [])
        if "이름" in head:
            out.update(read_google_form(f))
    for f in sorted(resp_dir.glob("labels_*.csv")):
        with f.open(encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                if not r.get("primary"):
                    continue
                rater = r["rater"].strip() or f.stem.removeprefix("labels_")
                out.setdefault(rater, {})[r["id"].zfill(2)] = {
                    "tags": {k for k in TAG_KEYS if r.get(k, "").strip() == "1"} | {r["primary"]},
                    "primary": r["primary"],
                    "unsure": r.get("unsure", "0").strip() == "1",
                    "note": r.get("note", "").strip(),
                }
    return out


def fleiss_kappa(counts: list[list[int]]) -> float | None:
    """counts[작품][범주] = 그 범주를 고른 평가자 수 (작품마다 평가자 수가 같아야 함). 1 = 완전 일치, 0 = 우연 수준"""
    if not counts:
        return None
    n = sum(counts[0])
    if n < 2:
        return None
    total = len(counts) * n
    p = [sum(row[j] for row in counts) / total for j in range(len(counts[0]))]
    p_bar = sum((sum(c * c for c in row) - n) / (n * (n - 1)) for row in counts) / len(counts)
    p_e = sum(x * x for x in p)
    if p_e >= 1:  # 모두가 모든 그림에 같은 답(전부 X 등) → 일치도를 정의할 수 없음
        return None
    return (p_bar - p_e) / (1 - p_e)


def kappa_label(k: float | None) -> str:
    if k is None:
        return "계산 불가"
    return "거의 완벽" if k >= 0.8 else "꽤 일치" if k >= 0.6 else "보통" if k >= 0.4 else "약함" if k >= 0.2 else "거의 우연"


def aggregate(labels: dict[str, dict[str, dict]], items: list[dict]):
    raters = sorted(labels)
    ids = [it["id"] for it in items if all(it["id"] in labels[r] for r in raters)]
    by_id = {it["id"]: it for it in items}
    n = len(raters)

    majority, disagreements = {}, []
    tag_counts = {k: [] for k in TAG_KEYS}
    prim_counts = []
    for i in ids:
        votes = {k: sum(k in labels[r][i]["tags"] for r in raters) for k in TAG_KEYS}
        dev = by_id[i]
        expected = []
        for k in TAG_KEYS:
            tag_counts[k].append([votes[k], n - votes[k]])
            if votes[k] * 2 > n or (votes[k] * 2 == n and k in dev["expected"]):
                expected.append(k)
            if 0 < votes[k] < n:
                disagreements.append({"id": i, "title": dev["title"], "항목": KO[k], "O": votes[k], "X": n - votes[k],
                                      "동점": "예" if votes[k] * 2 == n else "", "결과": "O" if k in expected else "X"})
        pv = Counter(labels[r][i]["primary"] for r in raters)
        prim_counts.append([pv.get(k, 0) for k in TAG_KEYS])
        top = max(pv.values())
        tied = [k for k in TAG_KEYS if pv.get(k, 0) == top]
        # 대표 태그 동점: 기존 정답 → 해당 태그 표가 많은 쪽 순으로 정함
        primary = dev["primary"] if dev["primary"] in tied else max(tied, key=lambda k: votes[k])
        if len(pv) > 1:
            disagreements.append({"id": i, "title": dev["title"], "항목": "대표 태그",
                                  "O": " · ".join(f"{KO[k]} {c}" for k, c in pv.most_common()), "X": "",
                                  "동점": "예" if len(tied) > 1 else "", "결과": KO[primary]})
        if primary not in expected:
            expected.append(primary)
        unsure = [r for r in raters if labels[r][i]["unsure"]]
        notes = [f"{r}: {labels[r][i]['note']}" for r in raters if labels[r][i]["note"]]
        majority[i] = {"primary": primary, "expected": [k for k in TAG_KEYS if k in expected], "unsure": unsure, "notes": notes}

    stats = {
        k: {"kappa": fleiss_kappa(tag_counts[k]),
            "full": sum(c[0] in (0, n) for c in tag_counts[k]) / max(len(ids), 1),
            "positive": sum(k in majority[i]["expected"] for i in ids)}
        for k in TAG_KEYS
    }
    stats["primary"] = {"kappa": fleiss_kappa(prim_counts), "full": sum(max(c) == n for c in prim_counts) / max(len(ids), 1)}
    return raters, ids, majority, stats, disagreements


def report(raters, ids, majority, stats, by_id) -> str:
    changed_primary = [i for i in ids if majority[i]["primary"] != by_id[i]["primary"]]
    changed_tags = sum(set(majority[i]["expected"]) ^ set(by_id[i]["expected"]) != set() for i in ids)
    lines = [
        "# 팀 태그 라벨 집계",
        "",
        f"- 평가자 {len(raters)}명: {', '.join(raters)}",
        f"- 모두가 라벨을 단 작품: {len(ids)}점",
        "",
        "## 사람끼리 얼마나 일치했나",
        "",
        "Fleiss' kappa: 1 = 완전 일치, 0 = 우연 수준 (0.6 이상이면 꽤 일치). 전원 일치 = 모든 평가자가 같은 답을 낸 그림 비율.",
        "",
        "| 항목 | kappa | 해석 | 전원 일치 | 다수결 O 작품 수 |",
        "|---|---|---|---|---|",
    ]
    for k in [*TAG_KEYS, "primary"]:
        s = stats[k]
        kap = "-" if s["kappa"] is None else f"{s['kappa']:.2f}"
        lines.append(f"| {KO.get(k, '대표 태그')} | {kap} | {kappa_label(s['kappa'])} | {s['full']:.0%} | {s.get('positive', '-')} |")
    lines += [
        "",
        "## 기존 정답(개발자 1인)과 비교",
        "",
        f"- 대표 태그가 바뀐 작품: {len(changed_primary)}점",
        f"- 태그 목록이 하나라도 바뀐 작품: {changed_tags}점",
        "",
        "| 번호 | 작품 | 기존 대표 | 다수결 대표 | 기존 태그 | 다수결 태그 |",
        "|---|---|---|---|---|---|",
    ]
    for i in ids:
        old, new = by_id[i], majority[i]
        if old["primary"] != new["primary"] or set(old["expected"]) != set(new["expected"]):
            lines.append(f"| {i} | {old['title']} | {KO[old['primary']]} | {KO[new['primary']]} | "
                         f"{' · '.join(KO[k] for k in old['expected'])} | {' · '.join(KO[k] for k in new['expected'])} |")
    unsure = [(i, majority[i]) for i in ids if majority[i]["unsure"] or majority[i]["notes"]]
    if unsure:
        lines += ["", "## 확신 없음 · 메모", "", "| 번호 | 작품 | 확신 없음 | 메모 |", "|---|---|---|---|"]
        lines += [f"| {i} | {by_id[i]['title']} | {', '.join(m['unsure'])} | {' / '.join(m['notes'])} |" for i, m in unsure]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="팀원 태그 라벨 집계")
    ap.add_argument("--apply", action="store_true", help="다수결 정답으로 tag_eval_set.json 교체")
    ap.add_argument("--responses", type=Path, default=RESP_DIR)
    args = ap.parse_args()

    data = json.loads(SET_FILE.read_text(encoding="utf-8"))
    items = data["items"]
    by_id = {it["id"]: it for it in items}
    labels = read_labels(args.responses)
    if len(labels) < 2:
        raise SystemExit(f"평가자가 2명 이상 필요해요 (지금 {len(labels)}명). {args.responses} 에 labels_<이름>.csv 를 넣어 주세요.")

    raters, ids, majority, stats, dis = aggregate(labels, items)
    RESULTS.mkdir(exist_ok=True)
    text = report(raters, ids, majority, stats, by_id)
    (RESULTS / "team_tags_report.md").write_text(text, encoding="utf-8")
    with (RESULTS / "team_tags_disagreements.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "title", "항목", "O", "X", "동점", "결과"])
        w.writeheader()
        w.writerows(sorted(dis, key=lambda d: (d["항목"] != "대표 태그", d["id"])))
    print(text)
    print(f"저장: {RESULTS / 'team_tags_report.md'}, {RESULTS / 'team_tags_disagreements.csv'} (갈린 칸 {len(dis)}개)")

    if args.apply:
        for i in ids:
            it = by_id[i]
            it.setdefault("primaryDev", it["primary"])  # 처음 적용할 때만 개발자 정답을 남겨 둔다
            it.setdefault("expectedDev", it["expected"])
            it["primary"], it["expected"] = majority[i]["primary"], majority[i]["expected"]
        data["note"] = (f"취향 태그 평가용 정답 — 팀원 {len(raters)}명({', '.join(raters)}) 다수결 "
                        "(evaluation/team_tags.py --apply). primaryDev·expectedDev = 예전 개발자 1인 정답. "
                        "primary = 대표 태그, expected = 해당하는 태그 전체.")
        SET_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{SET_FILE} 를 다수결 정답으로 바꿨어요 ({len(ids)}점). ai_validation.ipynb 1-8을 다시 실행하면 새 정답 기준 정확도가 나와요.")


if __name__ == "__main__":
    main()
