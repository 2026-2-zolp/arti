/**
 * U-13 마이페이지 — /mypage 직접 진입, 미로그인 시 U-03 인증 후 복귀
 * - 관람기록 탭: 지난 관람의 아트 영수증 목록 (누르면 /receipt/:visitId)
 * - 좋아요 목록 탭: 지난 관람에서 👍한 작품과 합성 전시의 대화 요약
 */
import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { ArtworkViewer } from '../../components/ArtworkViewer';
import { PendingReceipts } from '../../components/PendingReceipts';
import { useConfirm } from '../../components/Confirmation';
import { api, ApiError } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { errorDetail } from '../../lib/errorText';
import { TASTE_LABEL } from '../../data/mock';
import { useLogout, useVisit } from '../../store/VisitContext';
import { formatDate } from './U12Receipt';
import { KakaoAccountLink } from './KakaoAccountLink';
import { DocentMemoryControl } from './DocentMemoryControl';
import { AccountWithdrawal } from './AccountWithdrawal';
import type { Artwork, User, VisitRecord } from '../../types';
import '../../styles/mypage.css';

type Tab = 'history' | 'likes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '관람기록' },
  { id: 'likes', label: '좋아요 목록' },
];

/** 회원 정보와 관람 기록·선호 작품을 표시하는 화면 */
export default function U13MyPage() {
  const { state } = useVisit();
  const { search } = useLocation();
  if (!state.user) return <Navigate to={search ? `/login?redirect=${encodeURIComponent('/mypage' + search)}` : '/login?redirect=/mypage'} replace />;
  return <MyPageAccount key={state.user.id} user={state.user} />;
}

function MyPageAccount({ user }: { user: User }) {
  const { logout, logoutPending, logoutError } = useLogout();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'likes' ? 'likes' : 'history';
  const settingsPage = params.get('view') === 'settings';
  const listPath = tab === 'likes' ? '/mypage?tab=likes' : '/mypage';
  const settingsPath = tab === 'likes' ? '/mypage?tab=likes&view=settings' : '/mypage?view=settings';
  const recapId = tab === 'likes' ? params.get('artwork') : null;
  const navigate = useNavigate();
  const { state } = useLocation();
  const visits = useAsync(() => (!recapId && !settingsPage ? api.listVisits(user.id) : Promise.resolve([])), [user.id, recapId, settingsPage]);
  const transcript = useAsync(async () => {
    try {
      return await api.getDocentTranscriptSettings(user.id);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return null;
      throw e;
    }
  }, [user.id], true);

  if (recapId) return <LikedArtworkDetail key={recapId} artworkId={recapId} />;
  if (settingsPage) return <MobileShell screenId="U-13" title="계정 설정"
    back={() => state?.fromMyPage ? navigate(-1) : navigate(listPath, { replace: true })}>
    <div className="account-settings">
      {(user.docentMemorySettingsAvailable || transcript.data?.available || transcript.error) &&
        <section className="account-setting-section" aria-label="도슨트 설정">
          <h2>도슨트</h2>
          {user.docentMemorySettingsAvailable && <DocentMemoryControl userId={user.id} />}
          {transcript.data?.available && <TranscriptControl userId={user.id} settings={transcript.data} reload={transcript.reload} />}
          {transcript.error && <p className="error-text" role="alert">
            대화 저장 설정을 불러오지 못했어요.{errorDetail(transcript.error)}
            <button className="link-btn" onClick={transcript.reload}>다시 불러오기</button>
          </p>}
        </section>}
      <section className="account-setting-section" aria-label="회원 계정">
        <h2>계정</h2>
        <KakaoAccountLink key={user.id} />
        <AccountWithdrawal userId={user.id} />
      </section>
    </div>
  </MobileShell>;

  return (
    <MobileShell
      screenId="U-13"
      right={
        <div className="mypage-header-actions">
          <Link to={settingsPath} state={{ fromMyPage: true }} className="text-btn">계정 설정</Link>
          <button className="text-btn" disabled={logoutPending} onClick={() => logout()}>
            {logoutPending ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
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
            onClick={() => setParams(t.id === 'likes' ? { tab: 'likes' } : {}, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mypage-panel" role="tabpanel">
        {visits.loading && <Spinner />}
        {visits.error && (
          <div className="notice-card is-err" role="alert">
            <p className="notice-body">관람기록을 불러오지 못했어요.{errorDetail(visits.error)}</p>
            <button className="btn primary block" onClick={visits.reload}>다시 시도하기</button>
          </div>
        )}
        {visits.data && (tab === 'history' ? <HistoryList visits={visits.data} />
          : <LikeList visits={visits.data} transcriptAvailable={transcript.data?.available === true} />)}
      </div>
    </MobileShell>
  );
}

function TranscriptControl({ userId, settings, reload }: {
  userId: string; settings: Awaited<ReturnType<typeof api.getDocentTranscriptSettings>>; reload: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const perform = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '잠시 뒤 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  };
  return <details className="account-disclosure" aria-label="도슨트 대화 저장 관리">
    <summary><span>도슨트 대화 저장</span><small>{settings.enabled ? '켜짐' : '꺼짐'}</small><Icon name="chevron" size={16} /></summary>
    <div className="account-disclosure-body">
    <p>동의하면 질문과 답변을 탈퇴할 때까지 보관해요. 좋아요한 작품에서 다시 읽을 수 있어요.</p>
    {settings.hasConversations && <p>저장을 꺼도 이전 대화는 남아요.</p>}
    {settings.enabled ? <button className="btn outline" type="button" disabled={pending}
      onClick={() => void perform(() => api.setDocentTranscriptConsent(userId, { enabled: false }))}>앞으로 대화 저장 끄기</button>
      : settings.storageAvailable && <button className="btn outline" type="button" disabled={pending}
        onClick={() => void perform(() => api.setDocentTranscriptConsent(userId, { enabled: true, noticeVersion: settings.noticeVersion }))}>
        동의하고 대화 저장 켜기
      </button>}
    {settings.hasConversations && <button className="account-danger-link" type="button" disabled={pending} onClick={async () => {
      if (await confirm('저장한 모든 질문과 답변을 지웁니다. 이 작업은 되돌릴 수 없어요.', {
        title: '저장된 대화를 모두 삭제할까요?', confirm: '대화 모두 삭제', tone: 'danger',
      })) void perform(() => api.deleteDocentTranscripts(userId));
    }}>저장된 대화 모두 삭제</button>}
    {error != null && <p className="error-text" role="alert">대화 저장 설정을 변경하지 못했어요.{errorDetail(error)}</p>}
    </div>
  </details>;
}

const conversationTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit',
});

function LikedArtworkDetail({ artworkId }: { artworkId: string }) {
  const { data, loading, error, reload, setData } = useAsync(async () => {
    try {
      return await api.getLikedArtworkRecap(artworkId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }, [artworkId], true);
  const [showViewer, setShowViewer] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const transcriptHeading = useRef<HTMLHeadingElement>(null);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { state } = useLocation();
  const work = data?.artwork;
  const recap = data?.recap;
  const imageSrc = work ? artworkImageSrc(work) : undefined;
  const deleteConversation = async (visitId: string) => {
    if (!await confirm('이 관람의 질문과 답변을 지웁니다. 작품 좋아요와 영수증은 유지돼요.', {
      title: '이 관람의 대화를 삭제할까요?', confirm: '대화 삭제', tone: 'danger',
    })) return;
    setDeleting(visitId);
    setDeleteError(null);
    setDeleted(false);
    try {
      await api.deleteLikedArtworkConversation(artworkId, visitId);
      transcriptHeading.current?.focus();
      setData(current => current && {
        ...current, conversations: current.conversations?.filter(conversation => conversation.visitId !== visitId),
      });
      setDeleted(true);
      reload();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : '잠시 뒤 다시 시도해 주세요.');
    } finally {
      setDeleting(null);
    }
  };
  const image = work && <ArtImage seed={work.id} palette={work.palette} imageUrl={imageSrc} alt={work.title} fit="contain" />;

  return (
    <MobileShell screenId="U-13" title="좋아요한 작품"
      back={() => state?.fromLikes ? navigate(-1) : navigate('/mypage?tab=likes', { replace: true })}>
      {loading && !data && <Spinner />}
      {error && <div className="notice-card is-err" role="alert">
        <p className="notice-body">좋아요한 작품을 불러오지 못했어요.{errorDetail(error)}</p>
        <button type="button" className="btn primary block" onClick={reload}>다시 시도하기</button>
      </div>}
      {!loading && !error && !work && <div className="notice-card">
        <p>지금 볼 수 있는 좋아요 작품이 없어요.</p>
        <Link to="/mypage?tab=likes" replace className="link-btn">좋아요 목록으로</Link>
      </div>}
      {work && <article className="liked-review">
        <div className="liked-review-media">
          {imageSrc ? <button className="liked-review-expand" type="button" aria-label="도판 크게 보기" onClick={() => setShowViewer(true)}>
            {image}<span><Icon name="expand" size={19} /></span>
          </button> : image}
        </div>
        {showViewer && imageSrc && <ArtworkViewer seed={work.id} palette={work.palette} imageUrl={imageSrc}
          alt={work.title} onClose={() => setShowViewer(false)} />}
        <header>
          <h2>{work.title}</h2>
          <p className="muted">{[work.artist, work.year].filter(Boolean).join(' · ')}</p>
        </header>
        <section aria-label="작품 해설">
          <h3>작품 해설</h3>
          <p className="liked-artwork-description">{work.description || '등록된 해설을 준비하고 있어요.'}</p>
        </section>
        <section className="liked-record" aria-label="내 감상 기록">
          <h3>내 감상 기록</h3>
          <div className="liked-recap">
            <h4>도슨트 대화 요약</h4>
            {data && <p className="muted small">{formatDate(data.likedAt)} 관람</p>}
            {recap ? <>
              {recap.topics.length > 0 && <p>{recap.topics.join(' · ')}에 관해 질문했어요.</p>}
              {recap.style && <p>{recap.style}을 요청했어요.</p>}
            </> : <p className="muted">이 관람에서 요약할 도슨트 대화가 없어요.</p>}
          </div>
          {data?.conversations && <div className="liked-transcripts">
            <h4 ref={transcriptHeading} tabIndex={-1}>도슨트 대화 원문</h4>
            {deleted && <p className="muted small" role="status">이 관람의 대화를 삭제했어요.</p>}
            {data.conversations.length === 0 && <p className="muted">저장된 대화가 없어요.</p>}
            {data.conversations.map(({ visitId, likedAt, turns }) => <details className="account-disclosure liked-conversation" key={visitId}>
              <summary>
                <span>{formatDate(likedAt)} 관람 · 대화 {turns.length}쌍
                  <time className="muted small" dateTime={likedAt}>{conversationTime.format(new Date(likedAt))}</time>
                </span>
                <Icon name="chevron" size={16} />
              </summary>
              <div className="account-disclosure-body">
                <ol className="liked-turns">
                  {turns.map(({ id, question, answer }) => <li key={id}>
                    <div><strong>내 질문</strong><p>{question}</p></div>
                    <div><strong>도슨트</strong><p>{answer}</p></div>
                  </li>)}
                </ol>
                <button className="account-danger-link" type="button" disabled={deleting !== null}
                  onClick={() => void deleteConversation(visitId)}>이 관람의 대화 삭제</button>
              </div>
            </details>)}
            {deleteError != null && <p className="error-text" role="alert">대화를 삭제하지 못했어요.{errorDetail(deleteError)}</p>}
          </div>}
        </section>
      </article>}
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
function LikeList({ visits, transcriptAvailable }: { visits: VisitRecord[]; transcriptAvailable: boolean }) {
  const { data: artworks, loading, error, reload } = useAsync(() => api.listArtworks(), []);

  if (loading) return <Spinner />;
  if (error) return (
    <div className="notice-card is-err" role="alert">
      <p className="notice-body">좋아요한 작품을 불러오지 못했어요.{errorDetail(error)}</p>
      <button className="btn primary block" onClick={reload}>다시 시도하기</button>
    </div>
  );

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
        const content = <>
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
        </>;
        return w.visitRecapEnabled || transcriptAvailable ? (
          <li key={w.id}>
            <Link className="rec-card liked-artwork-link" to={`/mypage?tab=likes&artwork=${encodeURIComponent(w.id)}`} state={{ fromLikes: true }}
              aria-label={`${w.title} 다시 보기`}>
              {content}
              <Icon name="chevron" size={16} />
            </Link>
          </li>
        ) : <li key={w.id} className="rec-card">{content}</li>;
      })}
    </ul>
  );
}
