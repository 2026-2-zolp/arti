/**
 * U-10 작품 감상 — 서비스의 핵심 화면
 * 추천 이유 · 작품 해설 / Guided Looking / AI 맞춤 설명 탭 · 음성 설명(TTS) · AI 질문 · 👍/👎 · 다음 작품 안내
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useSpeech } from '../../lib/useSpeech';
import { reasonSentence } from '../../lib/recommend';
import { topEmotionLabels } from '../../components/EmotionBars';
import { useVisit } from '../../store/VisitContext';
import type { Reaction } from '../../types';

/**
 * 탭: 관찰부터 시작해 필요한 만큼 설명을 더한다 (중간발표 "설명에서 관찰로")
 * - 초보자 가이드: 쉬운 설명 + 관찰 질문(힌트 보기) — 관리자가 확정한 것만, 없으면 기본 관찰 팁
 * - 요약: AI 요약 + 키워드 — 관리자가 확정한 것만
 * - 작품 해설: 미술관 공식 해설 원문 + 출처
 * - AI 맞춤: 고른 취향에 맞춘 설명
 */
type Tab = 'guide' | 'summary' | 'desc' | 'ai';
const TABS: { id: Tab; label: string }[] = [
  { id: 'guide', label: '초보자 가이드' },
  { id: 'summary', label: '요약' },
  { id: 'desc', label: '작품 해설' },
  { id: 'ai', label: 'AI 맞춤' },
];
/** 관찰 질문이 아직 없는 작품에 보여 줄 기본 관찰 팁 (백엔드 BASIC_LOOKING_TIPS와 같은 내용) */
const BASIC_TIPS = [
  '그림에서 가장 밝은 곳을 먼저 찾아보세요. 눈이 가장 먼저 가는 곳이에요.',
  '화면에서 가장 넓게 쓰인 색은 무엇인가요?',
  '조금 떨어져서 한 번, 가까이 다가가서 한 번 보세요. 무엇이 달라 보이나요?',
];

export default function U10Artwork() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const { recommendations, current, reactions, tastes } = state;
  const free = state.mode === 'free'; // 자유 관람(U-16)에서 들어온 경우: 추천 이유·다음 작품 안내 대신 목록으로
  const rec = recommendations[current];

  const [tab, setTab] = useState<Tab>('guide');
  const [fullscreen, setFullscreen] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [openHints, setOpenHints] = useState<number[]>([]);
  const tts = useSpeech();

  const { data: w, loading } = useAsync(
    () => (rec ? api.getArtwork(rec.artworkId) : Promise.resolve(null)),
    [rec?.artworkId],
  );

  // 작품이 바뀌면 탭·AI 설명 초기화
  useEffect(() => {
    setTab('guide');
    setAiText(null);
    setOpenHints([]);
  }, [rec?.artworkId]);

  // AI 맞춤 설명 탭을 처음 열 때만 요청 (필요할 때 불러오기 = lazy loading)
  useEffect(() => {
    if (tab !== 'ai' || aiText || !rec) return;
    api.personalizedExplanation(rec.artworkId, tastes).then(setAiText);
  }, [tab, aiText, rec, tastes]);

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

  if (!rec) return <Navigate to={free ? '/browse' : recommendations.length ? '/receipt' : '/recommend'} replace />;

  const total = recommendations.length;
  const isLast = current === total - 1;
  const reaction = reactions[rec.artworkId];

  const setReaction = (r: Reaction) =>
    dispatch({ type: 'react', artworkId: rec.artworkId, reaction: reaction === r ? null : r });

  const goNext = () => {
    tts.stop();
    dispatch({ type: 'completeCurrent' });
    navigate(isLast ? '/receipt' : '/route');
  };

  const backToList = () => {
    tts.stop();
    navigate('/browse');
  };

  // 사용자 화면에는 관리자가 확정한 요약·가이드만 보여 준다
  const hasSummary = !!w && w.summaryStatus === 'confirmed' && w.summary.trim() !== '';
  const hasGuide = !!w && w.guideStatus === 'confirmed' && (w.guidedLooking.length > 0 || w.guideIntro.trim() !== '');
  const questions = hasGuide && w.guidedLooking.length ? w.guidedLooking : BASIC_TIPS;
  const hints = hasGuide ? w.guidedHints : [];
  const mood = w?.emotionStatus === 'confirmed' && w.analysis ? topEmotionLabels(w.analysis.emotions) : [];

  const tabText = (): string => {
    if (!w) return '';
    if (tab === 'guide') return [hasGuide ? w.guideIntro : '', ...questions.map((q, i) => `${i + 1}. ${q}`)].join(' ');
    if (tab === 'summary') return hasSummary ? w.summary : '';
    if (tab === 'desc') return w.description;
    return aiText ?? '';
  };

  const toggleSpeech = () => (tts.speaking ? tts.stop() : tts.speak(`${w?.title}. ${tabText()}`));

  return (
    <MobileShell
      screenId="U-10"
      back={free ? '/browse' : '/route'}
      title={
        free ? (
          <span className="progress-title">자유 관람 · {state.viewed.length}점 감상</span>
        ) : (
          <span className="progress-title">
            {current + 1} / {total}
            <span className="progress-bars" aria-hidden="true">
              {recommendations.map((r, i) => (
                <span key={r.artworkId} className={i <= current ? 'on' : ''} />
              ))}
            </span>
          </span>
        )
      }
      right={
        <button className="pill-btn" onClick={() => (free ? backToList() : navigate('/route'))}>
          <Icon name="map" size={18} /> {free ? '작품 목록' : '지도 보기'}
        </button>
      }
      footer={
        free ? (
          <div className="btn-row">
            <button className="btn outline" onClick={backToList}>
              목록으로
            </button>
            <button
              className="btn primary"
              onClick={() => {
                tts.stop();
                navigate('/receipt');
              }}
            >
              관람 마치기
            </button>
          </div>
        ) : (
          <button className="btn primary block" onClick={goNext}>
            {isLast ? '관람 마치기' : '다음 작품 안내'} <Icon name="arrow" size={20} />
          </button>
        )
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

          {!free && (
            <div className="reason-box">
              <Icon name="bulb" />
              <div>
                <strong>이 작품이 추천된 이유</strong>
                <p>{reasonSentence(rec.matchedTags, rec.aiTags ?? false)}</p>
              </div>
            </div>
          )}

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
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-panel" role="tabpanel">
            {tab === 'guide' && (
              <>
                {hasGuide && w.guideIntro.trim() && <p className="guide-intro">{w.guideIntro}</p>}
                {!hasGuide && <p className="muted small">아직 이 작품의 관찰 질문이 없어서, 어느 그림에나 쓸 수 있는 보는 방법을 알려 드려요.</p>}
                <span className="ai-label">{hasGuide ? '천천히 보며 답해 보세요' : '이렇게 보세요'}</span>
                <ol className="guided-list">
                  {questions.map((q, i) => (
                    <li key={q}>
                      {q}
                      {hints[i] && (
                        <>
                          {' '}
                          <button
                            className="link-btn inline hint-btn"
                            aria-expanded={openHints.includes(i)}
                            onClick={() => setOpenHints((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]))}
                          >
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
            {tab === 'summary' &&
              (hasSummary ? (
                <>
                  <span className="ai-label">AI 요약 · 미술관 해설 기반</span>
                  <p>{w.summary}</p>
                  {w.summaryKeywords.length > 0 && (
                    <div className="chips wrap mt-12">
                      {w.summaryKeywords.map((k) => (
                        <span key={k} className="chip sm outline">
                          #{k}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="muted">
                  아직 이 작품의 요약이 없어요.{' '}
                  <button className="link-btn inline" onClick={() => setTab('desc')}>
                    작품 해설 원문 보기
                  </button>
                </p>
              ))}
            {tab === 'desc' && (
              <>
                <span className="ai-label">미술관 공식 해설</span>
                <p className="pre-line">{w.description || '등록된 해설이 없어요.'}</p>
                <p className="source-line">출처: {w.source || '검수 중인 자료'}</p>
              </>
            )}
            {tab === 'ai' && (aiText ? <p className="pre-line">{aiText}</p> : <Spinner label="취향에 맞춘 설명을 만드는 중…" />)}
          </div>

          <div className="action-row">
            <button className="btn outline" onClick={toggleSpeech} disabled={!tts.supported || (tab === 'ai' && !aiText)}>
              <Icon name={tts.speaking ? 'stop' : 'speaker'} size={20} />
              {tts.speaking ? '재생 중지' : '음성 설명 듣기'}
            </button>
            <button className="btn outline" onClick={() => navigate('/artwork/ask')}>
              <Icon name="chat" size={20} /> AI에게 질문하기
            </button>
          </div>

          <div className="reaction-row">
            <span className="muted small">이 작품, 어땠나요? (선택)</span>
            <button
              className={`round-btn ${reaction === 'like' ? 'on' : ''}`}
              aria-pressed={reaction === 'like'}
              aria-label="좋아요"
              onClick={() => setReaction('like')}
            >
              <Icon name="thumbUp" />
            </button>
            <button
              className={`round-btn ${reaction === 'dislike' ? 'on' : ''}`}
              aria-pressed={reaction === 'dislike'}
              aria-label="별로예요"
              onClick={() => setReaction('dislike')}
            >
              <Icon name="thumbDown" />
            </button>
          </div>
        </>
      )}
    </MobileShell>
  );
}
