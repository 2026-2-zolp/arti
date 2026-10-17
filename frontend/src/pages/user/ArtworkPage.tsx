import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  ErrorState,
  Icon,
  Modal,
  QueryState,
  Skeleton,
  useToast,
} from '@/components/common';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useAiExplanation, useArtwork } from '@/hooks/queries/useUserQueries';
import { useArtworkId, useExhibitionId } from '@/hooks/useRouteParams';
import { useSpeech } from '@/hooks/useSpeech';
import { paths } from '@/routes/paths';
import type { Artwork, Reaction } from '@/types/domain';
import styles from './ArtworkPage.module.css';

type Tab = 'description' | 'guided' | 'ai';

const TABS: { id: Tab; label: string }[] = [
  { id: 'description', label: '작품 해설' },
  { id: 'guided', label: 'Guided Looking' },
  { id: 'ai', label: 'AI 맞춤 설명' },
];

/** U-10 작품 감상 */
export function ArtworkPage() {
  const exhibitionId = useExhibitionId();
  const artworkId = useArtworkId();
  const navigate = useNavigate();
  const query = useArtwork(exhibitionId, artworkId);
  const { session, goTo, markViewed, addViewTime, setReaction, finish } =
    useExhibitionSession(exhibitionId);

  const recommendations = session?.recommendations ?? [];
  const index = recommendations.findIndex((r) => r.artworkId === artworkId);
  const recommended = index >= 0 ? recommendations[index] : null;
  const total = recommendations.length;
  const hasNext = index >= 0 && index < total - 1;

  // 현재 관람 위치 갱신 + 감상 시간 기록 (아트 영수증 "가장 오래 본 작품")
  useEffect(() => {
    if (index < 0) return;
    goTo(index);
    markViewed(artworkId);
    const startedAt = Date.now();
    return () => addViewTime(artworkId, Math.round((Date.now() - startedAt) / 1000));
  }, [artworkId, index, goTo, markViewed, addViewTime]);

  const handleNext = () => {
    if (hasNext) {
      goTo(index + 1);
      navigate(paths.route(exhibitionId));
    } else {
      finish();
      navigate(paths.receipt(exhibitionId));
    }
  };

  return (
    <MobileLayout
      onBack={() => navigate(paths.route(exhibitionId))}
      title={
        index >= 0 && (
          <span className={styles.progress}>
            <span>
              {index + 1} / {total}
            </span>
            <span className={styles.bars} aria-hidden="true">
              {recommendations.map((r, i) => (
                <span
                  key={r.artworkId}
                  className={`${styles.bar} ${i <= index ? styles.barOn : ''}`}
                />
              ))}
            </span>
          </span>
        )
      }
      headerRight={
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Icon name="map" size={18} />}
          onClick={() => navigate(paths.route(exhibitionId))}
        >
          지도 보기
        </Button>
      }
      footer={
        <Button fullWidth rightIcon={<Icon name="arrowRight" size={20} />} onClick={handleNext}>
          {index < 0 ? '관람 경로로 돌아가기' : hasNext ? '다음 작품 안내' : '관람 마치기'}
        </Button>
      }
    >
      <QueryState
        query={query}
        loading={
          <div className={styles.stack}>
            <Skeleton height={260} radius={16} />
            <Skeleton width="60%" height={28} />
            <Skeleton width="40%" height={18} />
            <Skeleton height={90} radius={16} />
          </div>
        }
        errorTitle="작품 정보를 불러오지 못했어요"
      >
        {(artwork) => (
          <ArtworkContent
            artwork={artwork}
            reason={recommended?.recommendationReason ?? null}
            tasteIds={session?.tasteIds ?? []}
            reaction={session?.reactions[artworkId] ?? null}
            onReaction={(r) => setReaction(artworkId, r)}
            onAsk={() => navigate(paths.askAi(exhibitionId, artworkId))}
          />
        )}
      </QueryState>
    </MobileLayout>
  );
}

function ArtworkContent({
  artwork,
  reason,
  tasteIds,
  reaction,
  onReaction,
  onAsk,
}: {
  artwork: Artwork;
  reason: string | null;
  tasteIds: string[];
  reaction: Reaction | null;
  onReaction: (r: Reaction | null) => void;
  onAsk: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('description');
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const ai = useAiExplanation(artwork.artworkId, tasteIds, tab === 'ai');
  const speech = useSpeech();

  // 탭이 바뀌면 재생 중인 음성은 정지
  useEffect(() => {
    speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const currentText =
    tab === 'description'
      ? artwork.description
      : tab === 'guided'
        ? artwork.guidedLooking.join(' ')
        : (ai.data?.content ?? '');

  const toggleSpeech = () => {
    if (speech.speaking) return speech.stop();
    if (!speech.supported) return toast.error('이 브라우저는 음성 설명을 지원하지 않아요.');
    if (!currentText) return toast.show('설명을 불러온 뒤 다시 눌러 주세요.');
    speech.speak(`${artwork.title}. ${currentText}`);
  };

  const toggleReaction = (value: Reaction) => {
    const next = reaction === value ? null : value;
    onReaction(next);
    if (next) toast.show(next === 'like' ? '좋아요를 남겼어요' : '별로예요를 남겼어요');
  };

  return (
    <div className={styles.stack}>
      <div className={styles.imageWrap}>
        <img src={artwork.imageUrl} alt={artwork.title} className={styles.image} />
        <button
          type="button"
          className={styles.expand}
          onClick={() => setFullscreen(true)}
          aria-label="작품 이미지 크게 보기"
        >
          <Icon name="expand" size={20} />
        </button>
      </div>

      <div>
        <h2 className={styles.title}>{artwork.title}</h2>
        <p className={styles.meta}>
          {artwork.artist}
          <span className={styles.metaDivider}>|</span>
          {artwork.year}
        </p>
      </div>

      {reason && (
        <div className={styles.reason}>
          <Icon name="bulb" size={24} className={styles.reasonIcon} />
          <div>
            <p className={styles.reasonTitle}>이 작품이 추천된 이유</p>
            <p className={styles.reasonText}>
              ‘{reason}’ — 당신이 고른 취향과 맞닿아 있어 추천했어요.
            </p>
          </div>
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabOn : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.id === 'description' && tab === t.id && <Icon name="eye" size={18} />}
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.panel} role="tabpanel">
        {tab === 'description' && (
          <p className={`${styles.text} ${expanded ? '' : styles.clamp}`}>
            {artwork.description}{' '}
            {!expanded && artwork.description.length > 90 && (
              <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
                더보기
              </button>
            )}
          </p>
        )}
        {tab === 'guided' && (
          <ol className={styles.guided}>
            {artwork.guidedLooking.map((q, i) => (
              <li key={q}>
                <span className={styles.guidedNo}>{i + 1}</span>
                {q}
              </li>
            ))}
          </ol>
        )}
        {tab === 'ai' &&
          (ai.isPending ? (
            <div className={styles.stackSm}>
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton width="70%" height={16} />
            </div>
          ) : ai.isError ? (
            <ErrorState
              title="AI 설명을 만들지 못했어요"
              error={ai.error}
              onRetry={() => ai.refetch()}
              retrying={ai.isRefetching}
            />
          ) : (
            <p className={styles.text}>{ai.data.content}</p>
          ))}
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="md"
          leftIcon={<Icon name={speech.speaking ? 'stop' : 'speaker'} size={20} />}
          onClick={toggleSpeech}
        >
          {speech.speaking ? '음성 정지' : '음성 설명 듣기'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          leftIcon={<Icon name="chat" size={20} />}
          onClick={onAsk}
        >
          AI에게 질문하기
        </Button>
      </div>

      <div className={styles.reactions} role="group" aria-label="작품 선호도 (선택)">
        <span className={styles.reactionHint}>이 작품 어땠나요? (선택)</span>
        <button
          type="button"
          className={`${styles.reaction} ${reaction === 'like' ? styles.reactionOn : ''}`}
          aria-pressed={reaction === 'like'}
          aria-label="좋아요"
          onClick={() => toggleReaction('like')}
        >
          <Icon name="thumbUp" size={24} />
        </button>
        <button
          type="button"
          className={`${styles.reaction} ${reaction === 'dislike' ? styles.reactionOn : ''}`}
          aria-pressed={reaction === 'dislike'}
          aria-label="별로예요"
          onClick={() => toggleReaction('dislike')}
        >
          <Icon name="thumbDown" size={24} />
        </button>
      </div>

      <Modal
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        size="full"
        title={artwork.title}
      >
        <img src={artwork.imageUrl} alt={artwork.title} className={styles.fullImage} />
      </Modal>
    </div>
  );
}
