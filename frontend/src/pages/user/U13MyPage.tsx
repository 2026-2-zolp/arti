/**
 * U-13 마이페이지 — /mypage 직접 진입, 미로그인 시 U-03 인증 후 복귀
 * - 관람기록 탭: 지난 관람의 아트 영수증 목록 (누르면 /receipt/:visitId)
 * - 좋아요 목록 탭: 지난 관람에서 👍한 작품 (정보만 보여 주고 누를 수 없음)
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { PendingReceipts } from '../../components/PendingReceipts';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { TASTE_LABEL } from '../../data/mock';
import { useLogout, useVisit } from '../../store/VisitContext';
import { formatDate } from './U12Receipt';
import type { Artwork, VisitRecord } from '../../types';

type Tab = 'history' | 'likes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '관람기록' },
  { id: 'likes', label: '좋아요 목록' },
];

/** 회원 정보와 관람 기록·선호 작품을 표시하는 화면 */
export default function U13MyPage() {
  const { state } = useVisit();
  const { logout, logoutPending, logoutError } = useLogout();
  const user = state.user;
  const [tab, setTab] = useState<Tab>('history');
  const visits = useAsync(() => (user ? api.listVisits(user.id) : Promise.resolve([])), [user?.id]);

  if (!user) return <Navigate to="/login?redirect=/mypage" replace />;

  return (
    <MobileShell
      screenId="U-13"
      right={
        <button className="text-btn" disabled={logoutPending} onClick={() => logout()}>
          {logoutPending ? '로그아웃 중…' : '로그아웃'}
        </button>
      }
    >

      {logoutError && <p className="error-text" role="alert">{logoutError}</p>}
      <PendingReceipts onRecovered={visits.reload} />
      <Lead title={`${user.nickname || '회원'}님, 안녕하세요`} />

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mypage-panel" role="tabpanel">
        {visits.loading && <Spinner />}
        {visits.error && <p className="error-text">{visits.error}</p>}
        {visits.data && (tab === 'history' ? <HistoryList visits={visits.data} /> : <LikeList visits={visits.data} />)}
      </div>
    </MobileShell>
  );
}

/** 관람기록 탭: 영수증 카드 목록 */
function HistoryList({ visits }: { visits: VisitRecord[] }) {
  const navigate = useNavigate();

  if (visits.length === 0)
    return (
      <div className="empty">
        <p>아직 저장된 관람기록이 없어요.</p>
        <Link className="btn outline" to="/">
          관람 시작하기
        </Link>
      </div>
    );

  return (
    <ul className="history-list">
      {visits.map((v) => (
        <li key={v.id}>
          <button className="history-card" onClick={() => navigate(`/receipt/${v.id}`, { state: { from: '/mypage' } })}>
            <div className="history-top">
              <span className="muted small">
                <Icon name="pin" size={15} /> {v.venue}
              </span>
              <span className="muted small">{formatDate(v.date)}</span>
            </div>
            <strong>{v.exhibitionTitle}</strong>
            <div className="history-stats">
              <span>작품 {v.viewedArtworkIds.length}점</span>
              <span>관람 {v.durationMin}분</span>
              <span>👍 {Object.values(v.reactions).filter((r) => r === 'like').length}</span>
            </div>
            <span className="history-cta">
              <Icon name="receipt" size={16} /> 아트 영수증 보기 <Icon name="chevron" size={16} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 좋아요한 작품 목록 만들기
 * - visits는 최근 관람부터 (서버가 date 내림차순으로 줌)
 * - 작품마다 가장 최근 반응만 본다: 👍면 넣고, 나중 관람에서 👎했으면 뺀다 (같은 작품은 한 번만)
 * - 순서: 가장 최근에 👍한 관람 순, 한 관람 안에서는 작품 목록 순서
 * - 삭제된 작품(작품 목록에 없는 ID)은 뺀다
 */
function likedArtworks(visits: VisitRecord[], artworks: Artwork[]): Artwork[] {
  const order = new Map(artworks.map((w, i) => [w.id, i]));
  const byId = new Map(artworks.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const result: Artwork[] = [];
  const sorted = [...visits].sort((a, b) => b.date.localeCompare(a.date));
  for (const v of sorted) {
    const liked: Artwork[] = [];
    for (const [id, reaction] of Object.entries(v.reactions)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const w = byId.get(id);
      if (reaction === 'like' && w) liked.push(w);
    }
    liked.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    result.push(...liked);
  }
  return result;
}

/** 좋아요 목록 탭: U-08 추천 카드 모양 (이미지·작품명·작가·연도·태그) */
function LikeList({ visits }: { visits: VisitRecord[] }) {
  const { data: artworks, loading, error } = useAsync(() => api.listArtworks(), []);

  if (loading) return <Spinner />;
  if (error) return <p className="error-text">{error}</p>;

  const liked = likedArtworks(visits, artworks ?? []);
  if (liked.length === 0)
    return (
      <div className="empty">
        <p>아직 좋아요한 작품이 없어요.</p>
      </div>
    );

  return (
    <ul className="rec-list">
      {liked.map((w) => {
        // 이름표에 있는 태그만 보여 준다 (백엔드 예전 태그 calm·emotion은 이름이 없어 숨김)
        const tags = w.tags.filter((t) => TASTE_LABEL[t]);
        return (
          <li key={w.id} className="rec-card">
            <ArtImage className="rec-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={1.1} />
            <div className="rec-info">
              <strong>{w.title}</strong>
              <span className="muted small">
                {w.artist} · {w.year}
              </span>
              {tags.length > 0 && (
                <div className="chips">
                  {tags.map((t) => (
                    <span key={t} className="chip accent sm">
                      {TASTE_LABEL[t]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
