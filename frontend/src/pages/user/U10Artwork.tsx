/**
 * U-10 작품 감상 — 서비스의 핵심 화면
 * 추천 이유 · 작품 해설(원문 ↔ AI 요약) / 관람가이드 탭 · 음성 설명(TTS) · AI 질문 · 👍/👎 · 다음 작품 안내
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useSpeech } from '../../lib/useSpeech';
import { reasonSentence } from '../../lib/recommend';
import { topEmotionLabels } from '../../components/EmotionBars';
import { removeReactionLog, upsertReactionLog } from '../../lib/reactionLog';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Reaction } from '../../types';

const LIKE_REASONS = ['색감이 좋아요', '구도가 편해요', '분위기가 좋아요', '형태가 흥미로워요'];
const DISLIKE_REASONS = ['색감이 별로예요', '비율이 이상해요', '분위기가 맞지 않아요', '형태가 어색해요'];

type Tab = 'desc' | 'guided';
const TABS: { id: Tab; label: string }[] = [
  { id: 'desc', label: '작품 해설' },
  { id: 'guided', label: '관람가이드' },
];

/** 관리자가 확정한 관람가이드가 없는 작품에 보여 줄 기본 관찰 팁 (백엔드 BASIC_LOOKING_TIPS와 같은 내용) */
const BASIC_TIPS = [
  '그림에서 가장 밝은 곳을 먼저 찾아보세요. 눈이 가장 먼저 가는 곳이에요.',
  '화면에서 가장 넓게 쓰인 색은 무엇인가요?',
  '조금 떨어져서 한 번, 가까이 다가가서 한 번 보세요. 무엇이 달라 보이나요?',
];

export default function U10Artwork() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const to = useExhibitionPath();
  const { recommendations, current, reactions, reactionReasons } = state;
  const [ask, setAsk] = useState<Reaction | null>(null);
  const [customOn, setCustomOn] = useState(false);
  const [customText, setCustomText] = useState('');
  const rec = recommendations[current];

  const [tab, setTab] = useState<Tab>('desc');
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false); // 원문이 3줄을 넘는지 (넘을 때만 「더보기」)
  const [summaryOn, setSummaryOn] = useState(false); // 원문 자리에 AI 요약을 보여 주는 중
  const [openHints, setOpenHints] = useState<number[]>([]); // 관람가이드에서 힌트를 펼친 질문 번호
  const [fullscreen, setFullscreen] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const tts = useSpeech();

  const { data: w, loading } = useAsync(
    () => (rec ? api.getArtwork(rec.artworkId) : Promise.resolve(null)),
    [rec?.artworkId],
  );

  // 작품이 바뀌면 탭·원문 보기 상태 초기화
  useEffect(() => {
    setTab('desc');
    setExpanded(false);
    setSummaryOn(false);
    setOpenHints([]);
    setAsk(null);
    setCustomOn(false);
    setCustomText('');
  }, [rec?.artworkId]);

  // 접힌 원문이 실제로 잘렸는지 측정 (펼친 상태에서는 「접기」를 위해 그대로 둔다)
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [w?.description, tab, summaryOn, expanded]);

  // 감상 시간 측정: 화면에 들어온 시점을 기억했다가, 화면을 떠날 때(언마운트) 누적
  const enteredAt = useRef(Date.now());
  const recId = rec?.artworkId;
  useEffect(() => {
    if (!recId) return;
    enteredAt.current = Date.now();
    const id = recId;
    return () => {
      const seconds = Math.round((Date.now() - enteredAt.current) / 1000);
      dispatch({ type: 'addDwell', artworkId: id, seconds });
    };
  }, [recId, dispatch]);

  if (!rec) return <Navigate to={to(recommendations.length ? '/receipt' : '/recommend')} replace />;

  const total = recommendations.length;
  const isLast = current === total - 1;
  const reaction = reactions[rec.artworkId];
  const savedReason = reactionReasons[rec.artworkId];

  const openReason = (r: Reaction, currentReason?: string) => {
    const presets = r === 'like' ? LIKE_REASONS : DISLIKE_REASONS;
    const custom = !!currentReason && !presets.includes(currentReason);
    setAsk(r);
    setCustomOn(custom);
    setCustomText(custom ? currentReason : '');
  };

  const setReaction = (r: Reaction) => {
    // 이유 창이 열려 있을 때 같은 버튼을 다시 누르면 창만 닫는다 (반응은 그대로)
    if (ask === r) {
      setAsk(null);
      return;
    }
    // 창이 닫혀 있고 이미 같은 반응이면 반응 취소
    if (reaction === r && !ask) {
      dispatch({ type: 'react', artworkId: rec.artworkId, reaction: null });
      removeReactionLog(rec.artworkId);
      return;
    }
    openReason(r);
  };

  const confirmReason = (reason: string) => {
    const text = reason.trim();
    if (!ask || !text) return;
    dispatch({ type: 'react', artworkId: rec.artworkId, reaction: ask, reason: text });
    upsertReactionLog({ artworkId: rec.artworkId, reaction: ask, reason: text });
    setAsk(null);
  };

  const goNext = () => {
    tts.stop();
    dispatch({ type: 'completeCurrent' });
    navigate(to(isLast ? '/receipt' : '/route'));
  };

  // 원문을 먼저 보여 주고, 관리자가 확정한 AI 요약이 있을 때만 「AI 요약 보기」로 바꿔 볼 수 있다
  const hasSummary = !!w && w.summaryStatus === 'confirmed' && w.summary.trim() !== '';
  const showSummary = hasSummary && summaryOn;
  const mood = w?.emotionStatus === 'confirmed' && w.analysis ? topEmotionLabels(w.analysis.emotions) : [];

  // 관람가이드도 관리자가 확정한 것만 보여 주고, 없으면 어느 그림에나 쓸 수 있는 기본 관찰 팁
  const hasGuide = !!w && w.guideStatus === 'confirmed' && (w.guidedLooking.length > 0 || w.guideIntro.trim() !== '');
  const guideIntro = hasGuide ? w.guideIntro.trim() : '';
  const questions = hasGuide && w.guidedLooking.length ? w.guidedLooking : BASIC_TIPS;
  const hints = hasGuide && w.guidedLooking.length ? w.guidedHints : [];

  const tabText = (): string => {
    if (!w) return '';
    if (tab === 'desc') return showSummary ? w.summary : w.description;
    return [guideIntro, ...questions.map((q, i) => `${i + 1}. ${q}`)].filter(Boolean).join(' ');
  };

  const toggleHint = (i: number) => setOpenHints((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]));

  const toggleSummary = () => {
    tts.stop();
    setExpanded(false);
    setSummaryOn((v) => !v);
  };

  const toggleSpeech = () => (tts.speaking ? tts.stop() : tts.speak(`${w?.title}. ${tabText()}`));

  return (
    <MobileShell
      screenId="U-10"
      back={to('/route')}
      title={
        <span className="progress-title">
          {current + 1} / {total}
          <span className="progress-bars" aria-hidden="true">
            {recommendations.map((r, i) => (
              <span key={r.artworkId} className={i <= current ? 'on' : ''} />
            ))}
          </span>
        </span>
      }
      right={
        <button className="pill-btn" onClick={() => navigate(to('/route'))}>
          <Icon name="map" size={18} /> 지도 보기
        </button>
      }
      footer={
        <div className="footer-stack">
          {ask && (
            <ReasonPicker
              kind={ask}
              customOn={customOn}
              customText={customText}
              onPick={confirmReason}
              onCustom={() => setCustomOn(true)}
              onText={setCustomText}
              onClose={() => setAsk(null)}
            />
          )}
          <button className="btn primary block" onClick={goNext}>
            {isLast ? '관람 마치기' : '다음 작품 안내'} <Icon name="arrow" size={20} />
          </button>
        </div>
      }
    >
      {loading || !w ? (
        <Spinner />
      ) : (
        <>
          <div className={`art-frame ${fullscreen ? 'fullscreen' : ''}`}>
            <ArtImage seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={fullscreen ? 3 / 4 : 3 / 2} />
            <button
              className="frame-btn"
              aria-label={fullscreen ? '전체 화면 닫기' : '전체 화면'}
              onClick={() => setFullscreen((f) => !f)}
            >
              <Icon name={fullscreen ? 'close' : 'expand'} size={18} />
            </button>
          </div>

          <h2 className="art-title">{w.title}</h2>
          <p className="art-meta">
            {w.artist}
            <span className="sep">|</span>
            {w.year}
          </p>

          {mood.length > 0 && (
            <div className="mood-row">
              이 작품의 분위기
              {mood.map((m) => (
                <span key={m} className="chip sm accent">
                  {m}
                </span>
              ))}
              <span className="small">(AI 감정 분석)</span>
            </div>
          )}

          <div className="reason-box">
            <Icon name="bulb" />
            <div>
              <strong>이 작품이 추천된 이유</strong>
              <p>{reasonSentence(rec.matchedTags, rec.aiTags ?? false)}</p>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab ${tab === t.id ? 'on' : ''}`}
                onClick={() => {
                  tts.stop();
                  setTab(t.id);
                }}
              >
                {tab === t.id && t.id === 'desc' && <Icon name="eye" size={18} />}
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-panel" role="tabpanel">
            {tab === 'desc' && (
              <>
                {showSummary ? (
                  <>
                    <span className="ai-label">AI 요약 · 미술관 해설 기반</span>
                    <p>{w.summary}</p>
                  </>
                ) : (
                  <p ref={descRef} className={expanded ? '' : 'clamp-3'}>
                    {w.description}
                  </p>
                )}
                {((!showSummary && clamped) || hasSummary) && (
                  <div className="text-actions">
                    {!showSummary && clamped && (
                      <button className="link-btn inline" onClick={() => setExpanded((v) => !v)}>
                        {expanded ? '접기' : '더보기'}
                      </button>
                    )}
                    {hasSummary && (
                      <button className="link-btn" onClick={toggleSummary}>
                        {showSummary ? '원문 보기' : 'AI 요약 보기'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {tab === 'guided' && (
              <>
                {guideIntro && <p className="guide-intro">{guideIntro}</p>}
                {!hasGuide && (
                  <p className="muted small">아직 이 작품의 관찰 질문이 없어서, 어느 그림에나 쓸 수 있는 보는 방법을 알려 드려요.</p>
                )}
                <span className="ai-label">{hasGuide ? '천천히 보며 답해 보세요' : '이렇게 보세요'}</span>
                <ol className="guided-list">
                  {questions.map((q, i) => (
                    <li key={`${i}-${q}`}>
                      {q}
                      {hints[i] && (
                        <>
                          {' '}
                          <button className="link-btn inline hint-btn" aria-expanded={openHints.includes(i)} onClick={() => toggleHint(i)}>
                            {openHints.includes(i) ? '힌트 닫기' : '힌트 보기'}
                          </button>
                          {openHints.includes(i) && <span className="hint-text">💡 {hints[i]}</span>}
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <div className="action-row">
            <button className="btn outline" onClick={toggleSpeech} disabled={!tts.supported}>
              <Icon name={tts.speaking ? 'stop' : 'speaker'} size={20} />
              {tts.speaking ? '재생 중지' : '음성 설명 듣기'}
            </button>
            <button className="btn outline" onClick={() => navigate(to('/artwork/ask'))}>
              <Icon name="chat" size={20} /> AI에게 질문하기
            </button>
          </div>

          <div className="reaction-block">
            <div className="reaction-row">
              <span className="muted small">이 작품, 어땠나요? (선택)</span>
              {reaction && savedReason && (
                <button
                  type="button"
                  className={`reason-chip saved ${reaction}`}
                  aria-label={`${savedReason}, 이유 바꾸기`}
                  onClick={() => openReason(reaction, savedReason)}
                >
                  {savedReason}
                </button>
              )}
              <button
                className={`round-btn ${reaction === 'like' ? 'on' : ''}`}
                aria-pressed={reaction === 'like'}
                aria-label="좋아요"
                onClick={() => setReaction('like')}
              >
                <Icon name="thumbUp" />
              </button>
              <button
                className={`round-btn down ${reaction === 'dislike' ? 'on' : ''}`}
                aria-pressed={reaction === 'dislike'}
                aria-label="별로예요"
                onClick={() => setReaction('dislike')}
              >
                <Icon name="thumbDown" />
              </button>
            </div>
          </div>
        </>
      )}
    </MobileShell>
  );
}

function ReasonPicker({
  kind,
  customOn,
  customText,
  onPick,
  onCustom,
  onText,
  onClose,
}: {
  kind: Reaction;
  customOn: boolean;
  customText: string;
  onPick: (reason: string) => void;
  onCustom: () => void;
  onText: (value: string) => void;
  /** 이유를 고르지 않고 창만 닫기 (반응은 바뀌지 않음) */
  onClose: () => void;
}) {
  const presets = kind === 'like' ? LIKE_REASONS : DISLIKE_REASONS;
  return (
    <div className={`reason-sheet ${kind}`} role="group" aria-label={kind === 'like' ? '좋아요 이유' : '별로예요 이유'}>
      <div className="reason-sheet-head">
        <p className="muted small">{kind === 'like' ? '어떤 점이 좋았나요?' : '어떤 점이 아쉬웠나요?'}</p>
        <button type="button" className="text-btn" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="reason-options">
        {presets.map((label) => (
          <button key={label} type="button" className="reason-chip" onClick={() => onPick(label)}>
            {label}
          </button>
        ))}
        <button type="button" className={`reason-chip ${customOn ? 'on' : ''}`} onClick={onCustom}>
          기타
        </button>
      </div>
      {customOn && (
        <div className="reason-custom">
          <input
            value={customText}
            onChange={(e) => onText(e.target.value)}
            placeholder="이유를 적어 주세요"
            aria-label="직접 적은 이유"
          />
          <button type="button" className="btn primary" disabled={!customText.trim()} onClick={() => onPick(customText)}>
            남기기
          </button>
        </div>
      )}
    </div>
  );
}
