/**
 * U-05 취향 파악 — 그림 8장 1:1 토너먼트 (밸런스 게임)
 *
 * 그림 1장 = 취향 태그 1개 (public/taste/<태그>.jpg, 태그가 뚜렷한 공개 그림을 CLIP 점수로 골라 둠).
 * 8강 → 4강 → 결승, 7번 고르면 우승 = 1위 태그, 준우승 = 2위 태그 → 기본 취향 2개.
 * 결과 화면에서 1개를 더하거나 바꿀 수 있다 (최소 2개 · 최대 3개 — 30분 관람 3점에 태그마다 1점씩 보장되는 최대치).
 * 게임 없이 고르고 싶으면 「태그로 바로 고르기」. 대결 화면 디자인은 지성현 안(작품 양자택일)을 바탕으로 했다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { ArtImage } from '../../components/ArtImage';
import { TASTE_LABEL, TASTE_SAMPLES, tasteImageUrls } from '../../data/mock';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { fallbackTastes } from '../../lib/tasteFallback';
import { MissingNote } from '../../components/MissingNote';
import { useVisit } from '../../store/VisitContext';
import type { TasteTag } from '../../types';

const MIN_SELECT = 2;
const MAX_SELECT = 3;

/** 8강 대진 — 서로 대비되는 태그끼리 붙인다 (소재 · 형태와 빛 · 색의 세기 · 색의 온도) */
const FIRST_ROUND: [TasteTag, TasteTag][] = [
  ['landscape', 'people'],
  ['abstract', 'light'],
  ['vivid', 'soft'],
  ['warm', 'cool'],
];
const TOTAL_MATCHES = 7;
const ROUND_NAME = ['8강', '4강', '결승'];

interface Bracket {
  round: number; // 0 = 8강, 1 = 4강, 2 = 결승
  matchNo: number; // 이번 라운드에서 몇 번째 대결인지
  roundSize: number;
  match: [TasteTag, TasteTag] | null; // 끝났으면 null
  champion?: TasteTag;
  runnerUp?: TasteTag;
  semifinalists: TasteTag[]; // 4강에서 진 태그 (공동 3위)
  quarterfinalists: TasteTag[]; // 8강에서 진 태그
}

/** 지금까지 고른 순서(picks)로 대진표를 다시 계산한다 → 「이전」은 마지막 선택만 지우면 된다 */
function bracketOf(picks: TasteTag[]): Bracket {
  let matches = FIRST_ROUND;
  let round = 0;
  let winners: TasteTag[] = [];
  const semifinalists: TasteTag[] = [];
  const quarterfinalists: TasteTag[] = [];
  for (const pick of picks) {
    const [a, b] = matches[winners.length];
    winners.push(pick);
    if (round === 0) quarterfinalists.push(pick === a ? b : a);
    if (round === 1) semifinalists.push(pick === a ? b : a);
    if (winners.length < matches.length) continue;
    if (matches.length === 1) {
      return { round, matchNo: 0, roundSize: 1, match: null, champion: pick, runnerUp: pick === a ? b : a, semifinalists, quarterfinalists };
    }
    matches = Array.from({ length: winners.length / 2 }, (_, i) => [winners[i * 2], winners[i * 2 + 1]] as [TasteTag, TasteTag]);
    winners = [];
    round += 1;
  }
  return { round, matchNo: winners.length, roundSize: matches.length, match: matches[winners.length], semifinalists, quarterfinalists };
}

/** 토너먼트 순위 전체: 1위, 2위, 4강(공동 → 태그 고정 순서), 8강(공동 → 태그 고정 순서) */
function rankingOf(b: Bracket): TasteTag[] {
  if (!b.champion || !b.runnerUp) return [];
  const order = (tags: TasteTag[]) => TASTE_SAMPLES.map((s) => s.tag).filter((t) => tags.includes(t));
  return [b.champion, b.runnerUp, ...order(b.semifinalists), ...order(b.quarterfinalists)];
}

const paletteOf = (tag: TasteTag) => TASTE_SAMPLES.find((s) => s.tag === tag)!.palette;

export default function U05Taste() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  // 이 전시에 태그별 작품이 몇 점 있는지 (0점 태그는 결과 화면에서 안내)
  const { data: coverage } = useAsync(() => api.tagCoverage(state.exhibitionId), [state.exhibitionId]);
  const [picks, setPicks] = useState<TasteTag[]>([]);
  const [picked, setPicked] = useState<TasteTag | null>(null);
  // 결과(또는 「태그로 바로 고르기」) 화면에서 고친 태그. null이면 고치지 않음
  const [edited, setEdited] = useState<TasteTag[] | null>(null);
  const timer = useRef<number | null>(null);
  const bracket = useMemo(() => bracketOf(picks), [picks]);
  // 결승이 끝났으면 1·2위가 기본 취향. null이면 아직 게임 중
  const selected = edited ?? (bracket.champion && bracket.runnerUp ? [bracket.champion, bracket.runnerUp] : null);

  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const choose = (tag: TasteTag) => {
    if (timer.current) return;
    setPicked(tag);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPicked(null);
      setPicks((p) => [...p, tag]);
    }, 380);
  };

  const undo = () => {
    if (timer.current) return;
    setEdited(null);
    setPicks((p) => p.slice(0, -1));
  };

  const restart = () => {
    setEdited(null);
    setPicks([]);
  };

  const toggle = (tag: TasteTag) => {
    const list = selected ?? [];
    if (list.includes(tag)) setEdited(list.filter((t) => t !== tag));
    else if (list.length < MAX_SELECT) setEdited([...list, tag]);
  };

  const done = async () => {
    if (!selected) return;
    dispatch({ type: 'setTastes', tastes: selected, ranking: rankingOf(bracket) });
    if (state.user) {
      // 로그인 사용자는 다음 관람을 위해 취향을 계정에 저장
      await api.updateTastes(state.user.id, selected);
      dispatch({ type: 'login', user: { ...state.user, tastes: selected } });
    }
    navigate('/time');
  };

  // ── 결과 / 태그로 바로 고르기 ──
  if (selected !== null) {
    const ready = selected.length >= MIN_SELECT && selected.length <= MAX_SELECT;
    const rankOf = (tag: TasteTag) =>
      tag === bracket.champion ? '1위' : tag === bracket.runnerUp ? '2위' : bracket.semifinalists.includes(tag) ? '4강' : '';
    const fromGame = !!bracket.champion;
    return (
      <MobileShell
        screenId="U-05"
        title="취향 파악"
        right={
          picks.length > 0 ? (
            <button type="button" className="text-btn" onClick={undo}>
              이전
            </button>
          ) : undefined
        }
        footer={
          <>
            <button className="btn primary block" disabled={!ready} onClick={done}>
              이대로 추천 받기 ({selected.length})
            </button>
            <button className="btn ghost block" onClick={restart}>
              {fromGame ? '토너먼트 다시 하기' : '토너먼트로 고르기'}
            </button>
          </>
        }
      >
        {fromGame ? (
          <div className="duel-result">
            <span className="eyebrow">나의 취향</span>
            <h2>
              {TASTE_LABEL[bracket.champion!]} · {TASTE_LABEL[bracket.runnerUp!]}
            </h2>
            <div className="duel-result-art">
              {[bracket.champion!, bracket.runnerUp!].map((tag) => (
                <ArtImage key={tag} seed={`taste-${tag}`} palette={paletteOf(tag)} imageUrl={tasteImageUrls(tag)} alt={TASTE_LABEL[tag]} ratio={1} />
              ))}
            </div>
            <p className="muted small">우승과 준우승 그림의 특징이에요. 아래에서 1개를 더하거나 바꿀 수 있어요.</p>
          </div>
        ) : (
          <Lead title="끌리는 특징을 골라주세요" desc={`${MIN_SELECT}~${MAX_SELECT}개를 고르면 그 특징이 있는 작품을 추천해요.`} />
        )}

        <div className="tag-pick" role="group" aria-label="취향 태그">
          {TASTE_SAMPLES.map(({ tag }) => {
            const on = selected.includes(tag);
            const full = !on && selected.length >= MAX_SELECT;
            return (
              <button key={tag} type="button" className={`tag-pick-chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={full} onClick={() => toggle(tag)}>
                {TASTE_LABEL[tag]}
                {rankOf(tag) && <small>{rankOf(tag)}</small>}
                {coverage && !coverage[tag] && <small className="zero">이 전시 0점</small>}
              </button>
            );
          })}
        </div>
        <p className="muted small mt-12">
          {MIN_SELECT}~{MAX_SELECT}개 · {selected.length}개 선택됨
        </p>
        <MissingNote fallback={fallbackTastes(selected, rankingOf(bracket), coverage)} />
      </MobileShell>
    );
  }

  // ── 토너먼트 ──
  const match = bracket.match!;
  const played = picks.length;
  return (
    <MobileShell
      screenId="U-05"
      title="취향 파악"
      right={
        picks.length > 0 ? (
          <button type="button" className="text-btn" onClick={undo}>
            이전
          </button>
        ) : undefined
      }
      footer={
        <button className="btn ghost block" onClick={() => setEdited(state.tastes.slice(0, MAX_SELECT))}>
          태그로 바로 고르기
        </button>
      }
    >
      <Lead title="둘 중 더 끌리는 그림을 골라주세요" desc="정답은 없어요. 첫 느낌으로 7번만 고르면 취향을 찾아 드려요." />

      <div className="duel-head">
        <strong>
          {ROUND_NAME[bracket.round]}
          {bracket.roundSize > 1 && ` ${bracket.matchNo + 1}/${bracket.roundSize}`}
        </strong>
        <div className="duel-dots" aria-label={`${played + 1}번째 대결, 모두 ${TOTAL_MATCHES}번`}>
          {Array.from({ length: TOTAL_MATCHES }, (_, i) => (
            <span key={i} className={i === played ? 'on' : i < played ? 'done' : ''} />
          ))}
        </div>
      </div>

      <div className="duel">
        {match.map((tag, index) => (
          <div key={tag} className="duel-slot">
            {index === 1 && <p className="duel-or">VS</p>}
            <button
              type="button"
              className={`duel-card ${picked === tag ? 'picked' : ''}`}
              disabled={picked !== null}
              aria-label={`${index === 0 ? '위' : '아래'} 그림 고르기`}
              onClick={() => choose(tag)}
            >
              <ArtImage seed={`taste-${tag}`} palette={paletteOf(tag)} imageUrl={tasteImageUrls(tag)} alt="취향 그림" ratio={16 / 10} />
            </button>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}

