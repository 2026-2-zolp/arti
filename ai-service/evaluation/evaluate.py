"""
감정 분석 모델 비교 실험 (발표·보고서용)

같은 평가 데이터(eval_set.json)로 여러 모델·설정을 돌려
"대표 감정을 얼마나 맞히는지"를 비교하고 결과를 표로 저장한다.

실행 (ai-service 폴더에서, 가상환경 켠 상태):
    python -m evaluation.evaluate                  # 기본 설정 전체 비교
    python -m evaluation.evaluate --configs current large
    python -m evaluation.evaluate --image          # 작품 이미지(imagePath 캡처 파일 또는 imageUrl)로 CLIP 이미지 분석도 평가

결과:
    evaluation/results/report.md    정확도 비교표 + 작품별 결과 (슬라이드에 바로 쓰기 좋은 형식)
    evaluation/results/details.csv  작품·설정별 상위 3개 감정과 점수

지표:
    Top-1 정확도: 1위 감정이 정답(1~2개) 안에 있는 비율
    Top-2 정확도: 1·2위 중 하나라도 정답에 있는 비율
    보정(calibration): 모든 작품 평균 점수를 빼서 "어떤 라벨에나 높게 나오는" 모델 편향을 줄인 결과 (정답은 쓰지 않음)
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.emotions import EMOTION_KEYS, EMOTIONS

HERE = Path(__file__).parent
KO = {e["key"]: e["ko"] for e in EMOTIONS}


@dataclass
class TextConfig:
    name: str
    model: str
    labels: list[str]  # EMOTION_KEYS 순서
    template: str
    multi_label: bool
    desc: str


NOUN_LABELS = [e["nli"] for e in EMOTIONS]  # 평온함, 기쁨과 즐거움, ...
NOUN_TEMPLATE = "이 글이 묘사하는 작품의 분위기는 {}이다."

CONFIGS: dict[str, TextConfig] = {
    "current": TextConfig("current", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli", NOUN_LABELS, NOUN_TEMPLATE, True,
                          "현재 서비스 설정 (mDeBERTa-base, 다중 라벨)"),
    "single": TextConfig("single", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli", NOUN_LABELS, NOUN_TEMPLATE, False,
                         "mDeBERTa-base, 단일 라벨(감정끼리 경쟁)"),
    "2mil7": TextConfig("2mil7", "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7", NOUN_LABELS, NOUN_TEMPLATE, False,
                        "mDeBERTa-base, 다국어 NLI 270만 문장으로 추가 학습된 버전"),
    "large": TextConfig("large", "joeddav/xlm-roberta-large-xnli", NOUN_LABELS, NOUN_TEMPLATE, False,
                        "XLM-RoBERTa-large (더 큰 다국어 모델, 느림)"),
}


def rank(scores: dict[str, float]) -> list[str]:
    return sorted(EMOTION_KEYS, key=lambda k: scores[k], reverse=True)


def calibrate(all_scores: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    n = len(all_scores)
    mean = {k: sum(s[k] for s in all_scores.values()) / n for k in EMOTION_KEYS}
    return {i: {k: s[k] - mean[k] for k in EMOTION_KEYS} for i, s in all_scores.items()}


def run_text(cfg: TextConfig, items: list[dict]) -> tuple[dict[str, dict[str, float]], float]:
    from transformers import pipeline

    nli = pipeline("zero-shot-classification", model=cfg.model, device=-1)
    out: dict[str, dict[str, float]] = {}
    t0 = time.time()
    for it in items:
        r = nli(it["description"], candidate_labels=cfg.labels, hypothesis_template=cfg.template, multi_label=cfg.multi_label)
        by_label = dict(zip(r["labels"], r["scores"]))
        out[it["id"]] = {k: float(by_label[lbl]) for k, lbl in zip(EMOTION_KEYS, cfg.labels)}
    return out, (time.time() - t0) / max(1, len(items))


def run_image(items: list[dict]) -> tuple[dict[str, dict[str, float]], float]:
    import httpx
    from PIL import Image

    from app.analyzer import HuggingFaceScorer

    scorer = HuggingFaceScorer()
    out: dict[str, dict[str, float]] = {}
    t0 = time.time()
    for it in items:
        if it.get("imagePath"):  # 캡처한 이미지 파일 (evaluation 폴더 기준 상대 경로)
            img = Image.open(HERE / it["imagePath"])
        else:
            res = httpx.get(it["imageUrl"], timeout=20, follow_redirects=True, headers={"User-Agent": "ARTI-eval/0.1"})
            res.raise_for_status()
            img = Image.open(io.BytesIO(res.content))
        out[it["id"]] = scorer.image_scores(img.convert("RGB"))
    return out, (time.time() - t0) / max(1, len(items))


def score(items: list[dict], scores: dict[str, dict[str, float]]) -> tuple[float, float]:
    top1 = sum(rank(scores[i["id"]])[0] in i["expected"] for i in items) / len(items)
    top2 = sum(bool(set(rank(scores[i["id"]])[:2]) & set(i["expected"])) for i in items) / len(items)
    return top1, top2


def main() -> None:
    ap = argparse.ArgumentParser(description="ARTI 감정 분석 모델 비교 실험")
    ap.add_argument("--data", default=str(HERE / "eval_set.json"))
    ap.add_argument("--configs", nargs="*", default=list(CONFIGS), choices=list(CONFIGS))
    ap.add_argument(
        "--save-calibration",
        action="store_true",
        help="current 설정(서비스 모델)의 감정별 평균 점수를 app/calibration.json 에 저장 → 서비스가 라벨 편향 보정에 사용",
    )
    ap.add_argument("--image", action="store_true", help="imagePath(캡처 파일)·imageUrl이 있는 작품으로 CLIP 이미지 분석도 평가")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    items = data["items"]
    runs: list[tuple[str, str, dict[str, dict[str, float]], float, list[dict]]] = []
    prior: dict[str, dict[str, float]] = {}

    def mean_scores(raw: dict[str, dict[str, float]]) -> dict[str, float]:
        return {k: round(sum(s[k] for s in raw.values()) / len(raw), 4) for k in EMOTION_KEYS}

    for name in args.configs:
        cfg = CONFIGS[name]
        print(f"▶ {name}: {cfg.desc}", flush=True)
        raw, sec = run_text(cfg, items)
        if name == "current":
            prior["text"] = mean_scores(raw)
        runs.append((name, cfg.desc, raw, sec, items))
        runs.append((f"{name}+보정", f"{cfg.desc} + 라벨 편향 보정", calibrate(raw), sec, items))

    if args.image:
        img_items = [i for i in items if i.get("imagePath") or i.get("imageUrl")]
        if img_items:
            print(f"▶ image: CLIP 이미지 분석 ({len(img_items)}점)", flush=True)
            raw, sec = run_image(img_items)
            prior["image"] = mean_scores(raw)
            runs.append(("image", "CLIP ViT-B/32 이미지 제로샷", raw, sec, img_items))
            runs.append(("image+보정", "CLIP 이미지 + 라벨 편향 보정", calibrate(raw), sec, img_items))
        else:
            print("! imagePath·imageUrl이 있는 작품이 없어 이미지 평가는 건너뜁니다.")

    if args.save_calibration and prior:
        cal_file = HERE.parent / "app" / "calibration.json"
        cal_file.write_text(
            json.dumps(
                {
                    "note": f"evaluation/evaluate.py --save-calibration 으로 생성 ({datetime.now():%Y-%m-%d}, 작품 {len(items)}점). "
                    "감정별 평균 점수 = 모델의 라벨 편향. 실제 전시 작품으로 다시 생성하는 것을 권장.",
                    "prior": prior,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"보정값 저장: {cal_file} ({', '.join(prior)})")

    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)

    # 요약표
    lines = [
        "# 감정 분석 모델 비교 결과",
        "",
        f"- 실행: {datetime.now():%Y-%m-%d %H:%M} · 평가 작품 {len(items)}점 · 감정 6가지({', '.join(KO.values())})",
        "- 정답: `eval_set.json`의 작품별 대표 감정 1~2개 (사람이 판단한 예시 라벨)",
        "",
        "| 설정 | 설명 | 평가 수 | Top-1 정확도 | Top-2 정확도 | 작품당 시간(CPU) |",
        "|---|---|---|---|---|---|",
    ]
    best = None
    for name, desc, scores, sec, its in runs:
        t1, t2 = score(its, scores)
        lines.append(f"| {name} | {desc} | {len(its)} | {t1:.0%} | {t2:.0%} | {sec:.1f}초 |")
        if best is None or (t1, t2) > best[1:]:
            best = (name, t1, t2)
    if best:
        lines += ["", f"**가장 좋은 설정: `{best[0]}`** (Top-1 {best[1]:.0%}, Top-2 {best[2]:.0%})"]

    # 작품별 표
    header = "| 작품 | 정답 | " + " | ".join(r[0] for r in runs) + " |"
    lines += ["", "## 작품별 1위 감정 (✅ 정답 포함)", "", header, "|" + "---|" * (len(runs) + 2)]
    for it in items:
        cells = []
        for _, _, scores, _, its in runs:
            if it["id"] not in scores:
                cells.append("-")
                continue
            top = rank(scores[it["id"]])[0]
            cells.append(f"{KO[top]}{' ✅' if top in it['expected'] else ''}")
        lines.append(f"| {it['title']} | {', '.join(KO[e] for e in it['expected'])} | " + " | ".join(cells) + " |")
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    with open(out_dir / "details.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["설정", "작품", "정답", "1위", "2위", "3위", "1위 정답", *[KO[k] for k in EMOTION_KEYS]])
        for name, _, scores, _, its in runs:
            for it in its:
                s = scores[it["id"]]
                r = rank(s)
                w.writerow([name, it["title"], "/".join(KO[e] for e in it["expected"]), *[KO[k] for k in r[:3]],
                            "O" if r[0] in it["expected"] else "X", *[f"{s[k]:.3f}" for k in EMOTION_KEYS]])

    print("\n".join(lines[: 8 + len(runs) + 3]))
    print(f"\n저장: {out_dir / 'report.md'}, {out_dir / 'details.csv'}")


if __name__ == "__main__":
    main()
