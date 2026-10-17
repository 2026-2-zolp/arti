/**
 * U-10 작품 감상 — 서비스의 핵심 화면
 * 추천 이유 · 작품 해설 / Guided Looking / AI 맞춤 설명 탭 · 음성 설명(TTS) · AI 질문 · 👍/👎 · 다음 작품 안내
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useSpeech } from '../../lib/useSpeech';
import { reasonSentence } from '../../lib/recommend';
import { useVisit } from '../../store/VisitContext';
import type { Reaction } from '../../types';

type Tab = 'desc' | 'guided' | 'ai';
const TABS: { id: Tab; label: string }[] = [
  { id: 'desc', label: '작품 해설' },
  { id: 'guided', label: 'Guided Looking' },
  { id: 'ai', label: 'AI 맞춤 설명' },
];

export default function U10Artwork() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const { recommendations, current, reactions, tastes } = state;
  const rec = recommendations[current];

  const [tab, setTab] = useState<Tab>('desc');
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const tts = useSpeech();

  const { data: w, loading } = useAsync(
    () => (rec ? api.getArtwork(rec.artworkId) : Promise.resolve(null)),
    [rec?.artworkId],
  );

  // 작품이 바뀌면 탭·AI 설명 초기화
  useEffect(() => {
    setTab('desc');
    setAiText(null);
    setExpanded(false);
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

  if (!rec) return <Navigate to={recommendations.length ? '/receipt' : '/recommend'} replace />;

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

  const tabText = (): string => {
    if (!w) return '';
    if (tab === 'desc') return w.description;
    if (tab === 'guided') return w.guidedLooking.map((q, i) => `${i + 1}. ${q}`).join(' ');
    return aiText ?? '';
  };

  const toggleSpeech = () => (tts.speaking ? tts.stop() : tts.speak(`${w?.title}. ${tabText()}`));

  return (
    <MobileShell
      screenId="U-10"
      back="/route"
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
        <button className="pill-btn" onClick={() => navigate('/route')}>
          <Icon name="map" size={18} /> 지도 보기
        </button>
      }
      footer={
        <button className="btn primary block" onClick={goNext}>
          {isLast ? '관람 마치기' : '다음 작품 안내'} <Icon name="arrow" size={20} />
        </button>
      }
    >
      {loading || !w ? (
        <Spinner />
      ) : (
        <>
          <div className={`art-frame ${fullscreen ? 'fullscreen' : ''}`}>
            <ArtImage seed={w.id} palette={w.palette} imageUrl={w.imageUrl} alt={w.title} ratio={fullscreen ? 3 / 4 : 3 / 2} />
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

          <div className="reason-box">
            <Icon name="bulb" />
            <div>
              <strong>이 작품이 추천된 이유</strong>
              <p>{reasonSentence(rec.matchedTags)}</p>
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
              <p className={expanded ? '' : 'clamp-3'}>
                {w.description}{' '}
                {!expanded && (
                  <button className="link-btn inline" onClick={() => setExpanded(true)}>
                    더보기
                  </button>
                )}
              </p>
            )}
            {tab === 'guided' && (
              <ol className="guided-list">
                {w.guidedLooking.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
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
