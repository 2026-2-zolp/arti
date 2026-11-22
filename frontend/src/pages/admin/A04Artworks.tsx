/** 작품 정보·근거와 AI 산출물의 검수를 관리하는 화면 */
import {useConfirm} from '../../components/Confirmation';
/**
 * A-04 작품 등록·수정
 * - /admin/artworks        : 작품 목록 (전시·검수 상태 필터)
 * - /admin/artworks/new    : 새 작품 등록
 * - /admin/artworks/:id    : 작품 수정
 * 작품 해설과 AI 응답 데이터의 신뢰성을 위해 출처·참고자료·검수 상태를 함께 관리한다.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {analysisFailure, analysisOutcomes, analysisTime, failedAnalysisFields, mergeAnalysis, mergeCompletedEmotion,
  type ArtworkAnalysisField, type EmotionJob} from '../../lib/adminAnalysis';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { BASIC_LOOKING_TIPS } from '../../lib/visitScope';
import { AI_STATUS_LABEL, TAG_KEYS, TAG_THRESHOLD, TASTE_LABEL } from '../../data/mock';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { ArtworkViewer } from '../../components/ArtworkViewer';
import { Icon } from '../../components/Icon';
import { useProtectedImage } from '../../lib/useProtectedImage';
import { EmotionBars } from '../../components/EmotionBars';
import type { AiStatus, Artwork, DocentCollectionDraft, DocentCollectionReview, ReviewStatus, TasteTag } from '../../types';
import { PageHead, REVIEW_LABEL } from './AdminLayout';
import { formatDateTime } from '../../lib/adminDate';
import { ADMIN_PAGE_SIZE, AdminPagination, adminPage } from './AdminPagination';
import { useAnalysisQueue } from './AnalysisQueue';

const isVersionConflict = (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT';

/** 작품 목록과 검수 상태를 조회합니다. */
export function ArtworkList() {
  const confirm = useConfirm();
  const analysis = useAnalysisQueue();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const exFilter = params.get('exhibition') ?? '';
  const reviewFilter = params.get('review') ?? '';
  const surveyFilter = params.get('survey') === 'active';
  const { data, reload, error } = useAsync(() => Promise.all([api.listAdminExhibitions(), api.listAdminArtworks()]), []);
  const exhibition = data?.[0].find(ex => ex.id === exFilter);
  const alreadyRunning = analysis?.queue.batches.some(batch => batch.exhibitionId === exFilter && batch.active);

  async function startAnalysis() {
    if (!analysis || !exhibition) return;
    if (alreadyRunning) {
      analysis.show();
      return;
    }
    if (await confirm(`「${exhibition.title}」의 검수 완료 작품에서 미확정 항목을 분석할까요?`)) {
      await analysis.start(exhibition.id);
    }
  }

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const rows = (data?.[1] ?? []).filter(
    (w) =>
      (!exFilter || w.exhibitionId === exFilter) &&
      (!surveyFilter || w.usedInTasteSurvey) &&
      (!reviewFilter || (reviewFilter === 'todo' ? w.reviewStatus !== 'approved' : w.reviewStatus === reviewFilter)),
  );
  const { page, pages, offset } = adminPage(rows.length, Number(params.get('page')));
  const changePage = (nextPage: number) => {
    const next = new URLSearchParams(params);
    if (nextPage === 1) next.delete('page');
    else next.set('page', String(nextPage));
    setParams(next, { replace: true });
  };
  const roomName = (w: Artwork) =>
    data?.[0].find((e) => e.id === w.exhibitionId)?.rooms.find((r) => r.id === w.roomId)?.name ?? '-';

  return (
    <>
      <PageHead
        title="작품 관리"
        desc="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <>
            <button className="a-btn primary" onClick={() => navigate(`/admin/artworks/new${exFilter ? `?exhibition=${exFilter}` : ''}`)}>
              + 작품 등록
            </button>
          </>
        }
      />
      {error && <p className="error-text" role="alert">{error}<button onClick={reload}>다시 조회</button></p>}
      <div className="a-filters">
        <select value={exFilter} onChange={(e) => setFilter('exhibition', e.target.value)} aria-label="전시 필터">
          <option value="">전체 전시</option>
          {data?.[0].map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
        <select value={reviewFilter} onChange={(e) => setFilter('review', e.target.value)} aria-label="검수 상태 필터">
          <option value="">전체 검수 상태</option>
          <option value="todo">검수 필요 (대기+출처 확인)</option>
          {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((s) => (
            <option key={s} value={s}>
              {REVIEW_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={surveyFilter ? 'active' : ''} onChange={e => setFilter('survey', e.target.value)} aria-label="작품 용도 필터">
          <option value="">전체 작품 용도</option>
          <option value="active">취향 파악용</option>
        </select>
        <span className="muted small">{rows.length}건</span>
        {exhibition && analysis?.queue.enabled && (
          <button type="button" className="a-btn" disabled={analysis.busy} onClick={() => void startAnalysis()}>
            {alreadyRunning ? '분석 작업 보기' : '전시 일괄 분석'}
          </button>
        )}
      </div>
      <div className="a-card">
        <table className="a-table">
          <thead>
            <tr>
              <th className="a-thumb-col" style={{ width: 64 }} />
              <th>작품명</th>
              <th>작가</th>
              <th className="a-center">연도</th>
              <th>전시실</th>
              <th className="a-center">위치</th>
              <th className="a-center">검수 상태</th>
              <th>AI 감정·요약</th>
              <th>수정일시</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(offset, offset + ADMIN_PAGE_SIZE).map((w) => (
              <tr key={w.id} className="clickable" onClick={() => navigate(`/admin/artworks/${w.id}`)}>
                <td className="a-thumb-col">
                  <ArtImage className="a-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w, true)} alt="" ratio={1} />
                </td>
                <td>
                  <Link to={`/admin/artworks/${w.id}`} onClick={(e) => e.stopPropagation()}>
                    <strong>{w.title}</strong>
                  </Link>
                  {w.usedInTasteSurvey && <div className="a-badges"><span className="badge a-survey-badge">취향 파악용</span></div>}
                </td>
                <td>{w.artist}</td>
                <td className="a-center">{w.year}</td>
                <td>{roomName(w)}</td>
                <td className="a-center">{w.position ? '등록' : w.usedInTasteSurvey && !w.roomId ? '—' : <span className="text-warn">미등록</span>}</td>
                <td className="a-center">
                  <span className={`badge ${w.reviewStatus}`}>{REVIEW_LABEL[w.reviewStatus]}</span>
                </td>
                <td>
                  {/* 칸이 좁아 배지가 여러 줄로 쌓여도 줄 사이에 간격이 생기게 묶는다 */}
                  <div className="a-badges">
                    <span className={`badge ai-${w.tagStatus}`}>태그 {AI_STATUS_LABEL[w.tagStatus]}</span>
                    <span className={`badge ai-${w.emotionStatus}`}>감정 {AI_STATUS_LABEL[w.emotionStatus]}</span>
                    <span className={`badge ai-${w.summaryStatus}`}>요약 {AI_STATUS_LABEL[w.summaryStatus]}</span>
                  </div>
                </td>
                <td className="nowrap">{formatDateTime(w.updatedAt)}</td>
              </tr>
            ))}
            {data && !rows.length && <tr><td colSpan={9}>조건에 맞는 작품이 없어요.</td></tr>}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} pages={pages} total={rows.length} onChange={changePage} />
    </>
  );
}

const emptyArtwork = (exhibitionId: string): Artwork => ({
  id: '',
  exhibitionId,
  title: '',
  artist: '',
  year: '',
  roomId: '',
  position: null,
  palette: ['#EDE6DD', '#8C6A4A', '#2E3A4D', '#C99A55', '#F7F1E8'],
  tags: [],
  tagScores: null,
  tagStatus: 'none',
  description: '',
  guidedLooking: [],
  guidedHints: [],
  guideIntro: '',
  guideStatus: 'none',
  source: '',
  referenceUrl: '',
  reviewStatus: 'pending',
  updatedAt: '',
  analysis: null,
  emotionStatus: 'none',
  summary: '',
  summaryKeywords: [],
  summaryStatus: 'none',
  imageUrl: '',
  imageFile: null,
  showImage: true,
});

/** 단일 작품의 정보와 검수 상태를 편집합니다. */
export function ArtworkEdit() {
  const confirmAction = useConfirm();
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const { data, error, reload } = useAsync(
    () => Promise.all([api.listAdminExhibitions(), isNew ? Promise.resolve(null) : api.getAdminArtwork(id!)]),
    [id],
  );
  const [w, setW] = useState<Artwork | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'conflict'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!data) return;
    const initial = data[1] ?? emptyArtwork(params.get('exhibition') ?? data[0][0]?.id ?? '');
    setW(initial);
  }, [data, params]);

  const reloadAfterConflict = async () => {
    if (!(await confirmAction('최신 작품을 다시 불러오면 이 탭에서 저장하지 않은 수정이 사라져요.', { confirm: '다시 불러오기' }))) return;
    setMsg(null);
    reload();
  };

  if (error) return <><PageHead title="작품 등록·수정" desc={error} /><button onClick={reload}>다시 조회</button><button onClick={() => navigate('/admin/artworks')}>목록으로</button></>;
  if (!data || !w) return <PageHead title="작품 등록·수정" desc="불러오는 중…" />;

  const exhibitions = data[0];
  const rooms = exhibitions.find((e) => e.id === w.exhibitionId)?.rooms ?? [];
  const receiptProtected = w.receiptProtectedUntil !== undefined && Date.parse(w.receiptProtectedUntil) > Date.now();
  let deleteNote = '관람 기록, 도슨트 대화, 취향 조사 또는 관람 순서와 연결된 작품은 삭제할 수 없어요.';
  if (w.reviewStatus === 'approved') deleteNote = '삭제하려면 검수 상태를 변경한 뒤 먼저 저장해 주세요.';
  else if (receiptProtected) {
    deleteNote = `진행 중인 관람의 영수증 저장을 위해 ${formatDateTime(w.receiptProtectedUntil)}까지 삭제를 보류해요.`;
  }
  const set = <K extends keyof Artwork>(k: K, v: Artwork[K]) => setW((cur) => (cur ? { ...cur, [k]: v } : cur));
  const toggleTag = (t: TasteTag) => set('tags', w.tags.includes(t) ? w.tags.filter((x) => x !== t) : [...w.tags, t]);

  /** 입력 중인 내용과 함께 바로 저장 (태그 확정·해제 버튼용) */
  const saveWith = async (patch: Partial<Artwork>) => {
    const saved = await api.saveArtwork({ ...w, ...patch });
    setW(saved);
    return saved;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (deleting) return;
    if (!w.title.trim() || !w.artist.trim()) return setMsg({ type: 'err', text: '작품명과 작가는 필수입니다.' });
    if (w.reviewStatus === 'approved') {
      const missing = [!w.description.trim() && '작품 해설', !w.source.trim() && '출처'].filter(Boolean);
      if (missing.length) return setMsg({ type: 'err', text: `검수 완료로 저장하려면 ${missing.join('·')} 항목을 채워 주세요.` });
    }
    let saved: Artwork;
    try {
      saved = await api.saveArtwork(w);
    } catch (err) {
      return setMsg({ type: isVersionConflict(err) ? 'conflict' : 'err', text: err instanceof Error ? err.message : '저장하지 못했어요.' });
    }
    setW(saved);
    setMsg({
      type: 'ok',
      text:
        saved.emotionStatus !== w.emotionStatus || saved.summaryStatus !== w.summaryStatus || saved.tagStatus !== w.tagStatus ||
        saved.guideStatus !== w.guideStatus
          ? '저장했습니다. 공식 해설이나 이미지가 바뀌어 AI 결과를 다시 확인해야 해요(「AI 제안」으로 변경).'
          : '저장했습니다.',
    });
    if (isNew) navigate(`/admin/artworks/${saved.id}`, { replace: true });
  };

  const deleteWork = async () => {
    if (!w.id || w.version == null || w.reviewStatus === 'approved' || receiptProtected || deleting) return;
    if (!await confirmAction(`〈${data[1]?.title ?? w.title}〉 작품을 삭제할까요? 삭제한 작품은 되돌릴 수 없어요.`,
      { title: '작품 삭제', confirm: '삭제', tone: 'danger' })) return;
    setDeleting(true);
    setMsg(null);
    try {
      await api.deleteArtwork(w.id, w.version);
      navigate(`/admin/artworks?exhibition=${encodeURIComponent(data[1]?.exhibitionId ?? w.exhibitionId)}`, { replace: true });
    } catch (err) {
      setMsg({ type: isVersionConflict(err) || (err instanceof ApiError && err.status === 404) ? 'conflict' : 'err',
        text: err instanceof Error ? err.message : '작품을 삭제하지 못했어요.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <form onSubmit={submit}>
      <PageHead
        title="작품 등록·수정"
        desc="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <Link className="a-btn" to="/admin/artworks">
            목록으로
          </Link>
        }
      />
      <div className="a-two-col">
        <section className="a-card pad">
          <h2>기본 정보</h2>
          <label className="a-field">
            <span>작품명</span>
            <input value={w.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label className="a-field">
            <span>작가</span>
            <input value={w.artist} onChange={(e) => set('artist', e.target.value)} />
          </label>
          <label className="a-field">
            <span>제작연도</span>
            <input value={w.year} onChange={(e) => set('year', e.target.value)} placeholder="예: 1889" />
          </label>
          <div className="a-row">
            <label className="a-field">
              <span>전시</span>
              <select value={w.exhibitionId} onChange={(e) => set('exhibitionId', e.target.value)}>
                {exhibitions.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="a-field">
              <span>전시실 / 위치</span>
              <select value={w.roomId} onChange={(e) => set('roomId', e.target.value)}>
                <option value="">선택</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ImageField w={w} setW={setW} set={set} reloadArtwork={reloadAfterConflict} />
          <TagField w={w} toggleTag={toggleTag} setW={setW} save={saveWith} />
          <div className="a-field">
            <span>평면도 위치</span>
            <div className="a-inline">
              <span className={w.position ? '' : 'text-warn'}>
                {w.position ? `x ${w.position.x}, y ${w.position.y}` : '미등록'}
              </span>
              {w.id && (
                <Link className="a-btn sm" to={`/admin/map?exhibition=${w.exhibitionId}&artwork=${w.id}`}>
                  위치·지도 관리
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="a-card pad">
          <h2>설명 및 검수</h2>
          <label className="a-field">
            <span>작품 해설 원문 (출처 확인 후 사용자 「작품 해설」 탭에 표시)</span>
            <textarea rows={8} value={w.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <p className="muted small" style={{ marginTop: -6 }}>
            요약과 관람가이드(쉬운 설명 · 관찰 질문 · 힌트)는 아래 「AI 분석 · 요약 · 가이드」에서 만들고 확정해요.
          </p>
          <label className="a-field">
            <span>출처</span>
            <input value={w.source} onChange={(e) => set('source', e.target.value)} />
          </label>
          <label className="a-field">
            <span>참고자료 URL</span>
            <input type="url" value={w.referenceUrl} onChange={(e) => set('referenceUrl', e.target.value)} />
          </label>
          <div className="a-row end">
            <label className="a-field">
              <span>검수 상태</span>
              <select value={w.reviewStatus} onChange={(e) => set('reviewStatus', e.target.value as ReviewStatus)}>
                {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <button className="a-btn primary save" disabled={deleting}>저장</button>
          </div>
          {msg && (
            <p role={msg.type === 'ok' ? 'status' : 'alert'} className={msg.type === 'ok' ? 'ok-text' : 'error-text'}>
              {msg.text}
              {msg.type === 'conflict' && <button type="button" onClick={reloadAfterConflict}>최신 작품 다시 불러오기</button>}
            </p>
          )}
          <p className="muted small">검수 완료 + 위치 등록된 작품만 사용자 추천에 노출됩니다.</p>
          {w.id && (
            <div className="stack gap-10">
              <p className="muted small" id="artwork-delete-note">
                {deleteNote}
              </p>
              <div><button type="button" className="a-btn" aria-describedby="artwork-delete-note"
                disabled={deleting || w.reviewStatus === 'approved' || receiptProtected || msg?.type === 'conflict' || w.version == null}
                onClick={() => void deleteWork()}>{deleting ? '삭제 중…' : '작품 삭제'}</button></div>
            </div>
          )}
        </section>
      </div>
    </form>
      {w.id && <DocentCollectionPanel key={`${w.id}:${w.sourceVersion}:${w.reviewStatus}`} artworkId={w.id} />}
      <ArtworkContentPreview work={w} />
      {w.id ? (
        <AiPanel w={w} setW={setW} reloadArtwork={reloadAfterConflict} />
      ) : (
        <p className="muted small mt-24">작품을 먼저 저장하면 AI 감정 분석·해설 요약을 실행할 수 있어요.</p>
      )}
    </>
  );
}

const EMPTY_COLLECTION = { url: '', accession: '', excerpt: '' };

function DocentCollectionPanel({ artworkId }: { artworkId: string }) {
  const { data, loading, error, reload } = useAsync(() => api.getDocentCollection(artworkId), [artworkId]);
  const [saved, setSaved] = useState<DocentCollectionReview | null>(null);
  const [edits, setEdits] = useState<DocentCollectionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; conflict?: boolean } | null>(null);
  const review = saved ?? data;
  const stored = review?.draft ?? review?.approved ?? EMPTY_COLLECTION;
  const draft = edits ?? stored;
  const { url, accession, excerpt } = draft;
  const dirty = url !== stored.url || accession !== stored.accession || excerpt !== stored.excerpt;
  const stale = !!review?.draft && review.draft.sourceVersion !== review.sourceVersion;
  const canApprove = review?.canApprove && !!review.draft?.url && !!review.draft.accession && !!review.draft.excerpt && !stale && !dirty;
  const update = (field: keyof DocentCollectionDraft, value: string) => setEdits({ url, accession, excerpt, [field]: value });

  const restart = () => {
    setSaved(null);
    setEdits(null);
    setNotice(null);
    reload();
  };
  const submit = async (approve: boolean) => {
    if (!review || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { version, sourceVersion } = review;
      const next = await (approve
        ? api.approveDocentCollection(artworkId, version, sourceVersion)
        : api.saveDocentCollection(artworkId, { url, accession, excerpt }, version, sourceVersion));
      setSaved(next);
      setEdits(null);
      setNotice({ text: approve ? '소장처 근거를 승인했어요.' : '보강 초안을 저장했어요.' });
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : '보강 자료를 저장하지 못했어요.',
        error: true, conflict: err instanceof ApiError && err.status === 409 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="a-card pad ai-panel" aria-labelledby="docent-collection-title">
      <h2 id="docent-collection-title">도슨트 소장처 근거</h2>
      {error ? (
        <p role="alert">{error} <button type="button" className="a-btn sm" onClick={restart}>다시 불러오기</button></p>
      ) : loading || !review ? <p role="status">보강 자료를 불러오는 중이에요.</p> : (
        <>
          {review.approved && (
            <div>
              <h3>승인된 근거</h3>
              <a href={review.approved.url} target="_blank" rel="noreferrer">소장처 자료 · {review.approved.accession}</a>
              <p className="artwork-prose">{review.approved.excerpt}</p>
            </div>
          )}
          <form onSubmit={event => { event.preventDefault(); void submit(false); }}>
            <h3>보강 초안</h3>
            <label className="a-field">
              <span>소장처 URL</span>
              <input type="url" value={url} maxLength={2000} disabled={busy} onChange={e => update('url', e.target.value)} />
            </label>
            <label className="a-field">
              <span>소장번호</span>
              <input value={accession} maxLength={100} disabled={busy} onChange={e => update('accession', e.target.value)} />
            </label>
            <label className="a-field">
              <span id="docent-collection-excerpt">근거 문장</span>
              <textarea aria-labelledby="docent-collection-excerpt" rows={3} value={excerpt} maxLength={1000} disabled={busy}
                onChange={e => update('excerpt', e.target.value)} />
            </label>
            {stale && <p className="small">작품 원문이 바뀌었어요. 소장처 근거를 확인하고 초안을 다시 저장해 주세요.</p>}
            {!review.canApprove && <p className="small">작품의 검수가 완료되면 보강 초안을 승인할 수 있어요.</p>}
            <div className="a-row end">
              <button type="submit" className="a-btn" disabled={busy || !(url.trim() || accession.trim() || excerpt.trim()) ||
                (!dirty && !stale && Boolean(review.draft ?? review.approved))}>보강 초안 저장</button>
              <button type="button" className="a-btn primary" disabled={busy || !canApprove} onClick={() => void submit(true)}>소장처 근거 승인</button>
            </div>
          </form>
          {notice && (
            <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'error-text' : 'ok-text'}>
              {notice.text}
              {notice.conflict && <button type="button" className="a-btn sm" onClick={restart}>최신 보강 자료 불러오기</button>}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ArtworkContentPreview({ work }: { work: Artwork }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="a-card pad ai-panel" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>관람자 미리보기</summary>
      {open && <ArtworkPreviewComparison key={`${work.id}:${work.version}`} work={work} />}
    </details>
  );
}

function ArtworkPreviewComparison({ work }: { work: Artwork }) {
  const { id } = work;
  const { data, error, loading, reload } = useAsync(async () => {
    if (!id) return null;
    try {
      return await api.getArtwork(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [id]);
  const changed = data && [
    work.source !== data.source && '출처',
    work.referenceUrl !== data.referenceUrl && '참고자료 URL',
    work.description !== data.description && '작품 해설',
    work.summary !== data.summary && '쉬운 요약',
    (work.guideIntro !== data.guideIntro ||
      JSON.stringify(work.guidedLooking) !== JSON.stringify(data.guidedLooking) ||
      JSON.stringify(work.guidedHints) !== JSON.stringify(data.guidedHints)) && '관람가이드',
  ].filter(Boolean);
  return (
    <>
      {changed && <p className="small" role="status">{changed.length > 0
        ? `공개본과 다른 항목 · ${changed.join(' · ')}`
        : '공개본과 내용이 같아요.'}</p>}
      <div className="ai-grid">
        <section className="ai-box" aria-label="현재 공개본">
          <h3>현재 공개본</h3>
          {id && <button className="a-btn sm" type="button" onClick={reload} disabled={loading}>공개본 새로고침</button>}
          {loading ? <p role="status">공개본을 불러오는 중이에요.</p> : error ? (
            <p role="alert">공개본을 불러오지 못했어요.</p>
          ) : data ? (
            <ArtworkTextPreview work={data} />
          ) : <p>현재 관람자에게 공개된 작품 내용이 없어요.</p>}
        </section>
        <section className="ai-box" aria-label="편집 중인 내용">
          <h3>편집 중인 내용</h3>
          <ArtworkTextPreview work={work} />
        </section>
      </div>
    </>
  );
}

function ArtworkTextPreview({ work }: { work: Artwork }) {
  const questions = work.guidedLooking.length ? work.guidedLooking : BASIC_LOOKING_TIPS;
  return (
    <>
      {work.sourceVersion != null && <p className="muted small">저장된 근거 버전 {work.sourceVersion}</p>}
      <h4>출처</h4>
      <p className="artwork-prose">{work.source || '출처가 비어 있어요.'}</p>
      {work.referenceUrl && <p className="artwork-prose">{work.referenceUrl}</p>}
      <h4>작품 해설</h4>
      <p className="artwork-prose">{work.description || '작품 해설이 비어 있어요.'}</p>
      <h4>쉬운 요약</h4>
      <p className="artwork-prose">{work.summary || '쉬운 요약이 비어 있어요.'}</p>
      <h4>관람가이드</h4>
      {work.guideIntro && <p className="guide-intro">{work.guideIntro}</p>}
      {!work.guidedLooking.length && <p className="muted small">기본 감상 팁</p>}
      <ol className="guided-list">
        {questions.map((question, index) => (
          <li key={`${index}-${question}`}>
            {question}
            {work.guidedHints[index] && <p className="hint-text">힌트 · {work.guidedHints[index]}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * 작품 이미지: 캡처한 파일 올리기(클릭 또는 끌어다 놓기) / 이미지 URL / 사용자 화면 표시 여부
 * 파일은 고르는 즉시 서버에 저장된다. 이미지가 바뀌면 확정된 AI 결과는 「AI 제안」으로 돌아간다.
 */
function ImageField({
  w,
  setW,
  set,
  reloadArtwork,
}: {
  w: Artwork;
  setW: (f: (cur: Artwork | null) => Artwork | null) => void;
  set: <K extends keyof Artwork>(k: K, v: Artwork[K]) => void;
  reloadArtwork: () => Promise<void>;
}) {
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; conflict?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);
  const { src } = useProtectedImage(artworkImageSrc(w, true));
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [viewingSrc, setViewingSrc] = useState<string>();
  const previewButton = useRef<HTMLButtonElement>(null);

  // 서버가 바꾼 필드만 반영하고, 화면에서 수정 중인 다른 입력값은 그대로 둔다
  const applyServer = (saved: Artwork) =>
    setW((cur) =>
      cur?.id === saved.id ? {
        ...cur,
        imageFile: saved.imageFile,
        reviewStatus: saved.reviewStatus,
        receiptProtectedUntil: saved.receiptProtectedUntil,
        emotionStatus: saved.emotionStatus,
        summaryStatus: saved.summaryStatus,
        guideStatus: saved.guideStatus,
        tagStatus: saved.tagStatus,
        savedTextProposals: saved.savedTextProposals,
        version: saved.version,
        sourceVersion: saved.sourceVersion,
        contentVersion: saved.contentVersion,
        summaryRevision: saved.summaryRevision,
        guideRevision: saved.guideRevision,
        updatedAt: saved.updatedAt,
      } : cur,
    );

  const saveImage = async (request: () => Promise<Artwork>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      applyServer(await request());
    } catch (e) {
      setErr({ text: e instanceof Error ? e.message : fallback, conflict: isVersionConflict(e) });
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setErr({ text: 'PNG, JPG, WEBP 이미지만 올릴 수 있어요.' });
    if (file.size > 10 * 1024 * 1024) return setErr({ text: '이미지는 10MB 이하로 올려 주세요.' });
    await saveImage(() => api.uploadArtworkImage(w.id, file, w.version), '업로드에 실패했어요.');
  };

  const removeFile = async () => {
    if (busy || !(await confirmAction('올린 이미지 파일을 삭제할까요?'))) return;
    await saveImage(() => api.deleteArtworkImage(w.id, w.version), '파일을 삭제하지 못했어요.');
  };

  return (
    <div className="a-field">
      <span>작품 이미지</span>
      {w.id ? (
        <div
          className={`img-drop ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            uploadFile(e.dataTransfer.files[0]);
          }}
        >
          {src ? (
            <button ref={previewButton} type="button" className="img-preview" aria-label="작품 이미지 크게 보기"
              aria-haspopup="dialog" disabled={loadedSrc !== src} onClick={() => setViewingSrc(src)}>
              <img key={src} src={src} alt="" onLoad={() => setLoadedSrc(src)} onError={() => setLoadedSrc(undefined)} />
              {loadedSrc === src && <Icon name="expand" size={16} />}
            </button>
          ) : <div className="img-empty">이미지 없음</div>}
          <div className="img-drop-actions">
            <label className="a-btn sm">
              {busy ? '처리 중…' : w.imageFile ? '다른 이미지로 바꾸기' : '이미지 파일 올리기'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={busy}
                onChange={(e) => {
                  uploadFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {w.imageFile && (
              <button type="button" className="a-btn sm" onClick={removeFile} disabled={busy}>
                파일 삭제
              </button>
            )}
            <span className="muted small">캡처 이미지를 끌어다 놓아도 돼요 (PNG·JPG·WEBP, 10MB 이하)</span>
          </div>
        </div>
      ) : (
        <p className="muted small">작품을 먼저 저장하면 이미지 파일을 올릴 수 있어요.</p>
      )}
      {viewingSrc && viewingSrc === src && (
        <ArtworkViewer seed={w.id} palette={w.palette} imageUrl={viewingSrc} alt={w.title || '작품 이미지'} variant="modal"
          onClose={() => { setViewingSrc(undefined); previewButton.current?.focus(); }} />
      )}
      {err && (
        <p className="error-text" role="alert">
          {err.text}
          {err.conflict && <button type="button" onClick={reloadArtwork}>최신 작품 다시 불러오기</button>}
        </p>
      )}
      <input
        value={w.imageUrl ?? ''}
        onChange={(e) => set('imageUrl', e.target.value || undefined)}
        placeholder="또는 이미지 URL https:// (파일을 올리면 파일이 우선)"
      />
      <label className="ai-check">
        <input type="checkbox" checked={w.showImage} onChange={(e) => set('showImage', e.target.checked)} />
        사용자 화면에 이미지 표시 (끄면 AI 분석에만 사용하고 화면에는 자리표시 그림)
      </label>
    </div>
  );
}

/**
 * AI 분석·요약 패널
 * - 「AI 분석 실행」에서 생성한 요약·가이드·취향 태그·감정 분석은 「AI 제안」 상태로 저장된다
 * - 관리자가 결과를 확인·수정한 뒤 「확정」해야 사용자 화면과 추천에 쓰인다
 * - 취향 태그 제안은 「기본 정보」의 태그 버튼(TagField)에 표시하고, 여기서는 감정(설명용)·요약을 다룬다
 */
function AiPanel({ w, setW, reloadArtwork }: {
  w: Artwork;
  setW: (f: (cur: Artwork | null) => Artwork | null) => void;
  reloadArtwork: () => Promise<void>;
}) {
  const confirmAction = useConfirm();
  const [useImage, setUseImage] = useState(true);
  const [useDraftImage, setUseDraftImage] = useState(false);
  const [draftTasks, setDraftTasks] = useState<('summary' | 'guide')[]>([]);
  const [busy, setBusy] = useState<'analysis' | 'save' | null>(null);
  const [emotionJob, setEmotionJob] = useState<EmotionJob | null>(null);
  const [jobRevision, refreshJob] = useState(0);
  const inFlight = useRef(false);
  const retryRequest = useRef({ fields: [] as ArtworkAnalysisField[], draftImage: false, tagImage: true });
  const [msg, setMsg] = useState<
    {type: 'ok' | 'err' | 'save-error' | 'conflict'; text: string} | {type: 'result'; items: ReturnType<typeof analysisOutcomes>} | null
  >(null);
  const blocked = busy !== null || msg?.type === 'conflict';

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = jobRevision > 0;
    const check = async () => {
      try {
        const {job} = await api.artworkEmotionJob(w.id);
        if (!active) return;
        setEmotionJob(job);
        if (job) setW(current => current?.id === w.id ? mergeCompletedEmotion(current, job) : current);
        waiting = job?.state === 'queued' || job?.state === 'running';
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) waiting = false;
      }
      if (active && waiting) timer = setTimeout(check, 2000);
    };
    if (w.id) void check();
    return () => { active = false; clearTimeout(timer); };
  }, [setW, w.id, w.sourceVersion, jobRevision]);

  useEffect(() => {
    let active = true;
    api.adminOperations('summary').then((report) => {
      if (active) setDraftTasks(report.draftImageTasks ?? []);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const run = async (
    regenerateFields: ArtworkAnalysisField[] = [],
    draftImage = !!w.imageFile && useDraftImage && regenerateFields.length > 0 &&
      regenerateFields.every((field) => (field === 'summary' || field === 'guide') && draftTasks.includes(field)),
    tagImage = useImage,
  ) => {
    if (inFlight.current || msg?.type === 'conflict') return;
    inFlight.current=true;
    retryRequest.current = { fields: regenerateFields, draftImage, tagImage };
    setBusy('analysis');
    setMsg(null);
    try {
      const r = await api.analyzeArtwork(w.id, tagImage, regenerateFields, draftImage, w.version);
      // 화면에서 수정 중인 다른 입력값은 유지하고 AI 결과 필드만 바꾼다
      setW((cur) => cur && mergeAnalysis(cur,w,r));
      retryRequest.current = { fields: failedAnalysisFields(r), draftImage, tagImage };
      const items = analysisOutcomes(r).filter(item => !r.emotionJob || item.label !== '감정 분석');
      setMsg({type: 'result', items});
      if (r.emotionJob) {
        setEmotionJob(r.emotionJob);
        refreshJob(revision => revision + 1);
      }
    } catch (e) {
      setMsg({ type: isVersionConflict(e) ? 'conflict' : 'err', text: analysisFailure(e) });
    } finally {
      inFlight.current=false;
      setBusy(null);
    }
  };

  const retry = () => {
    const { fields, draftImage, tagImage } = retryRequest.current;
    void run(fields, draftImage, tagImage);
  };

  /** 확정/해제는 바로 서버에 저장 */
  const setStatus = async (patch: Partial<Pick<Artwork, 'emotionStatus' | 'summaryStatus' | 'guideStatus'>>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('save');
    try {
      const saved = await api.saveArtwork({ ...w, ...patch });
      setW(() => saved);
      const demoted = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => saved[k] !== patch[k]);
      setMsg(
        demoted
          ? { type: 'err', text: '공식 해설·이미지가 분석 때와 달라져 확정할 수 없어요. 「AI 다시 분석」 후 확정해 주세요.' }
          : { type: 'ok', text: '저장했습니다.' },
      );
    } catch (e) {
      setMsg((current) => current?.type === 'conflict'
        ? current
        : { type: isVersionConflict(e) ? 'conflict' : 'err', text: e instanceof Error ? e.message : '저장하지 못했어요.' });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const discard = async (kind: 'summary' | 'guide') => {
    if (inFlight.current || msg?.type === 'conflict') return;
    const label = kind === 'summary' ? '쉬운 요약' : '관람가이드';
    if (!await confirmAction(`${label} 제안을 폐기할까요? 현재 공개된 내용은 유지돼요.`, { confirm: '제안 폐기' })) return;
    inFlight.current = true;
    setBusy('save');
    setMsg(null);
    try {
      const saved = await api.discardArtworkProposal(w, kind);
      setW((current) => {
        if (!current || current.id !== saved.id || (current.version ?? 0) > (saved.version ?? 0)) return current;
        const text = kind === 'summary'
          ? { summary: saved.summary, summaryKeywords: saved.summaryKeywords, summaryStatus: saved.summaryStatus, summaryRevision: saved.summaryRevision }
          : { guideIntro: saved.guideIntro, guidedLooking: saved.guidedLooking, guidedHints: saved.guidedHints, guideStatus: saved.guideStatus, guideRevision: saved.guideRevision };
        return { ...current, ...text, version: saved.version, updatedAt: saved.updatedAt, savedTextProposals: saved.savedTextProposals };
      });
      setMsg({ type: 'ok', text: `${label} 제안을 폐기했어요.` });
    } catch (e) {
      setMsg({ type: isVersionConflict(e) ? 'conflict' : 'save-error', text: e instanceof Error ? e.message : '제안을 폐기하지 못했어요.' });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const badge = (s: AiStatus) => <span className={`badge ai-${s}`}>{AI_STATUS_LABEL[s]}</span>;
  const a = w.analysis;

  return (
    <section className="a-card pad ai-panel">
      <div className="ai-panel-head">
        <div>
          <h2>AI 분석 · 요약 · 가이드</h2>
          <p className="muted small">
            저장된 작품 해설{w.imageFile || w.imageUrl ? '과 이미지' : ''}를 기준으로 분석합니다. AI 결과는 「AI 제안」으로 저장되고, 확인 후
            「확정」해야 사용자 화면과 추천에 반영돼요.
          </p>
        </div>
        <div className="a-inline">
          {(w.imageFile || w.imageUrl) && (
            <label className="ai-check">
              <input type="checkbox" checked={useImage} onChange={(e) => setUseImage(e.target.checked)} />
              이미지도 분석
            </label>
          )}
          <button type="button" className="a-btn primary" disabled={blocked} onClick={() => run()}>
            {busy === 'analysis' ? 'AI 분석 중… 잠시 기다려 주세요' : a || w.summary ? 'AI 다시 분석' : 'AI 분석 실행'}
          </button>
        </div>
      </div>
      <div className="a-inline">
        <button className="a-btn sm" type="button" disabled={blocked} onClick={() => run(['summary'])}>쉬운 요약 다시 생성</button>
        <button className="a-btn sm" type="button" disabled={blocked} onClick={() => run(['guide'])}>관람가이드 다시 생성</button>
        {w.imageFile && draftTasks.length > 0 && (
          <label className="ai-check">
            <input type="checkbox" disabled={blocked} checked={useDraftImage} onChange={(e) => setUseDraftImage(e.target.checked)} />
            {draftTasks.length === 2 ? '요약·가이드' : draftTasks[0] === 'summary' ? '쉬운 요약' : '관람가이드'} Luna 생성에 도판 사용
          </label>
        )}
      </div>
      <p className="muted small">새 제안을 확정할 때까지 현재 공개된 요약과 관람가이드가 표시돼요.</p>
      {emotionJob && emotionJob.sourceVersion === w.sourceVersion && (
        <div role="status" aria-label="백그라운드 감정 분석" className="a-inline small">
          <strong>감정 분석</strong>
          {emotionJob.state === 'queued' && <span>분석 대기 중이에요.</span>}
          {emotionJob.state === 'running' && <span>백그라운드에서 분석 중이에요. 다른 제안은 먼저 검수할 수 있어요.</span>}
          {emotionJob.state === 'ready' && <span>감정 제안이 준비됐어요.</span>}
          {emotionJob.state === 'stale' && <span>작품 자료가 바뀌었어요. 최신 자료로 다시 분석해 주세요.</span>}
          {emotionJob.state === 'failed' && <>
            <span>{emotionJob.code === 'AI_TIMEOUT' ? '감정 분석 시간이 초과됐어요.' : '감정 분석을 완료하지 못했어요.'}</span>
            <button className="a-btn sm" type="button" disabled={blocked}
              onClick={() => run(['emotion'], false, emotionJob.useImage)}>감정만 다시 시도</button>
          </>}
          {emotionJob.state === 'ready' && typeof emotionJob.resultVersion === 'number'
            && (w.version ?? 0) < emotionJob.resultVersion && (
              <button className="a-btn sm" type="button" onClick={reloadArtwork}>최신 감정 제안 불러오기</button>
          )}
        </div>
      )}
      {msg?.type === 'result' && (
        <div role="status" aria-label="AI 항목별 처리 결과" style={{ marginBottom: 14 }}>
          <ul className="small">
            {msg.items.map(({label, status, text}) => (
              <li key={label} className={status === 'failed' ? 'error-text' : undefined}>
                <strong>{label}</strong> · {text}
              </li>
            ))}
          </ul>
          {retryRequest.current.fields.length > 0 && (
            <button type="button" disabled={blocked} onClick={retry}>분석 다시 시도</button>
          )}
        </div>
      )}
      {msg && msg.type !== 'result' && (
        <p role={msg.type === 'ok' ? 'status' : 'alert'} className={msg.type === 'ok' ? 'ok-text' : 'error-text'} style={{ marginBottom: 14 }}>
          {msg.text}
          {msg.type === 'conflict' && <button type="button" onClick={reloadArtwork}>최신 작품 다시 불러오기</button>}
          {msg.type === 'err' && <button type="button" disabled={blocked} onClick={retry}>분석 다시 시도</button>}
        </p>
      )}

      <div className="ai-grid">
        <div className="ai-box">
          <div className="ai-box-head">
            <h3>감정 분석 (작품 분위기 설명용)</h3>
            {badge(w.emotionStatus)}
          </div>
          {a ? (
            <>
              <EmotionBars scores={a.emotions} />
              <p className="ai-meta">
                분석 재료: {a.usedText === undefined ? (a.usedImage ? '이미지 + 해설' : '해설 텍스트') : [a.usedImage && '이미지', a.usedText && '해설'].filter(Boolean).join(' + ')} ·
                추천에는 쓰지 않고 작품 화면·아트 영수증에 표시
                {a.imageError && <> (이미지 실패: {a.imageError})</>}
                <br />
                모델: {a.models.image} · {a.models.text}
                <br />
                분석 시각: {analysisTime(a.analyzedAt)}
              </p>
              <div className="ai-actions">
                {w.emotionStatus !== 'confirmed' ? (
                  <button type="button" className="a-btn sm primary" disabled={busy !== null} onClick={() => setStatus({ emotionStatus: 'confirmed' })}>
                    감정 분석 확정
                  </button>
                ) : (
                  <button type="button" className="a-btn sm" disabled={busy !== null} onClick={() => setStatus({ emotionStatus: 'suggested' })}>
                    확정 해제
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="muted small">아직 분석하지 않았어요. 「AI 분석 실행」을 눌러 주세요.</p>
          )}
        </div>

        <div className="ai-box">
          <div className="ai-box-head">
            <h3>요약 (사용자 「작품 해설」 탭의 「AI 요약 보기」)</h3>
            {badge(w.summaryStatus)}
          </div>
          <label className="a-field">
            <span>요약 (직접 고칠 수 있어요)</span>
            <textarea
              rows={5}
              value={w.summary}
              onChange={(e) => setW((cur) => cur && { ...cur, summary: e.target.value, summaryStatus: cur.summaryStatus === 'none' ? 'suggested' : cur.summaryStatus })}
              placeholder="「AI 분석 실행」으로 공식 해설을 요약하거나 직접 입력하세요."
            />
          </label>
          <label className="a-field">
            <span>키워드 (쉼표로 구분)</span>
            <input
              value={w.summaryKeywords.join(', ')}
              onChange={(e) =>
                setW((cur) => cur && { ...cur, summaryKeywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 5) })
              }
            />
          </label>
          <div className="ai-actions">
            {w.summaryStatus !== 'confirmed' ? (
              <button
                type="button"
                className="a-btn sm primary"
                disabled={busy !== null || !w.summary.trim()}
                onClick={() => setStatus({ summaryStatus: 'confirmed' })}
              >
                요약 확정 (수정 내용 포함 저장)
              </button>
            ) : (
              <button type="button" className="a-btn sm" disabled={busy !== null} onClick={() => setStatus({ summaryStatus: 'suggested' })}>
                확정 해제
              </button>
            )}
            {w.savedTextProposals?.includes('summary') && (
              <button type="button" className="a-btn sm" disabled={blocked} onClick={() => discard('summary')}>쉬운 요약 제안 폐기</button>
            )}
          </div>
        </div>

        <GuideCard w={w} setW={setW} badge={badge(w.guideStatus)} setStatus={setStatus}
          busy={busy !== null} discardBlocked={blocked} onDiscard={() => discard('guide')} />
      </div>
    </section>
  );
}

/** 관찰 질문 한 줄 = "질문 | 힌트" (힌트는 없어도 됨) */
const formatQuestions = (w: Pick<Artwork, 'guidedLooking' | 'guidedHints'>) =>
  w.guidedLooking.map((q, i) => (w.guidedHints[i] ? `${q} | ${w.guidedHints[i]}` : q)).join('\n');
const parseQuestions = (text: string) => {
  const rows = text
    .split('\n')
    .map((line) => line.split('|'))
    .map(([q, ...h]) => [q.trim(), h.join('|').trim()] as const)
    .filter(([q]) => q);
  return { guidedLooking: rows.map(([q]) => q), guidedHints: rows.map(([, h]) => h) };
};

/**
 * 관람가이드 (사용자 「관람가이드」 탭) — 쉬운 설명 + 관찰 질문 + 질문마다 힌트
 * AI 분석이 제안하거나 관리자가 직접 쓰고, 「가이드 확정」해야 사용자 화면에 보인다.
 */
function GuideCard({
  w,
  setW,
  badge,
  setStatus,
  busy,
  discardBlocked,
  onDiscard,
}: {
  w: Artwork;
  setW: (f: (cur: Artwork | null) => Artwork | null) => void;
  badge: ReactNode;
  setStatus: (patch: Partial<Pick<Artwork, 'guideStatus'>>) => Promise<void>;
  busy: boolean;
  discardBlocked: boolean;
  onDiscard: () => void;
}) {
  // 입력 중인 글은 그대로 두고(예: "질문 |"까지 쓴 상태), 저장된 값이 밖에서 바뀌었을 때만(AI 제안 등) 다시 채운다
  const [text, setText] = useState(() => formatQuestions(w));
  const outside = formatQuestions(w);
  useEffect(() => {
    if (formatQuestions(parseQuestions(text)) !== outside) setText(outside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside]);
  const touch = (s: AiStatus) => (s === 'none' ? 'suggested' : s);
  const empty = !w.guideIntro.trim() && w.guidedLooking.length === 0;

  return (
    <div className="ai-box">
      <div className="ai-box-head">
        <h3>관람가이드 (사용자 「관람가이드」 탭)</h3>
        {badge}
      </div>
      <label className="a-field">
        <span>쉬운 설명 (그림을 보기 전에 읽는 2~3문장)</span>
        <textarea
          rows={3}
          value={w.guideIntro}
          onChange={(e) => setW((cur) => cur && { ...cur, guideIntro: e.target.value, guideStatus: touch(cur.guideStatus) })}
          placeholder="어려운 용어 없이, 이 그림이 무엇을 그린 것인지 쉽게"
        />
      </label>
      <label className="a-field">
        <span>관찰 질문 — 한 줄에 하나, 「질문 | 힌트」</span>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const parsed = parseQuestions(e.target.value);
            setW((cur) => cur && { ...cur, ...parsed, guideStatus: touch(cur.guideStatus) });
          }}
          placeholder={'화면에서 가장 밝은 사람은 누구인가요? | 가운데 노란 옷의 인물을 보세요\n하늘의 붓질은 어느 방향으로 흐르나요? | 손가락으로 따라가 보세요'}
        />
      </label>
      <div className="ai-actions">
        {w.guideStatus !== 'confirmed' ? (
          <button type="button" className="a-btn sm primary" disabled={busy || empty} onClick={() => setStatus({ guideStatus: 'confirmed' })}>
            가이드 확정 (수정 내용 포함 저장)
          </button>
        ) : (
          <button type="button" className="a-btn sm" disabled={busy} onClick={() => setStatus({ guideStatus: 'suggested' })}>
            확정 해제
          </button>
        )}
        {w.savedTextProposals?.includes('guide') && (
          <button type="button" className="a-btn sm" disabled={discardBlocked} onClick={onDiscard}>관람가이드 제안 폐기</button>
        )}
      </div>
    </div>
  );
}

/**
 * 취향 태그 (추천에 사용) — 사용자 취향 카드와 같은 8개
 * AI 분석을 하면 태그마다 점수를 보여 주고, 관리자가 「AI 제안대로 켜기」 → 고치기 → 「태그 확정」.
 * 확정하면 그대로 둔 태그는 AI 점수, 관리자가 바꾼 태그는 켬 1 / 끔 0으로 추천에 쓰인다(서버 계산).
 * 확정 전에는 켠 태그 1, 나머지 0.
 */
function TagField({
  w,
  toggleTag,
  setW,
  save,
}: {
  w: Artwork;
  toggleTag: (t: TasteTag) => void;
  setW: (f: (cur: Artwork | null) => Artwork | null) => void;
  save: (patch: Partial<Artwork>) => Promise<Artwork>;
}) {
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const ai = w.tagStatus === 'none' ? null : w.tagScores ?? w.analysis?.tags ?? null;
  const scoreSource = w.tagScoreSource || w.analysis?.tagSource;
  const suggested = ai ? TAG_KEYS.filter((t) => ai[t] >= TAG_THRESHOLD).sort((a, b) => ai[b] - ai[a]) : [];

  const run = async (patch: Partial<Artwork>, ok: string) => {
    try {
      const saved = await save(patch);
      setMsg(
        patch.tagStatus === 'confirmed' && saved.tagStatus !== 'confirmed'
          ? { type: 'err', text: '공식 해설·이미지가 분석 때와 달라져 확정할 수 없어요. 「AI 다시 분석」 후 확정해 주세요.' }
          : { type: 'ok', text: ok },
      );
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '저장하지 못했어요.' });
    }
  };

  return (
    <div className="a-field">
      <span className="a-inline">
        취향 태그 (추천에 사용)
        {ai && <span className={`badge ai-${w.tagStatus}`}>{AI_STATUS_LABEL[w.tagStatus]}</span>}
      </span>
      <div className="chips wrap">
        {TAG_KEYS.map((t) => (
          <button
            type="button"
            key={t}
            className={`chip ${w.tags.includes(t) ? 'accent' : 'outline'}`}
            aria-pressed={w.tags.includes(t)}
            onClick={() => toggleTag(t)}
          >
            {TASTE_LABEL[t]}
            {ai && <span className={`tag-score ${ai[t] >= TAG_THRESHOLD ? 'on' : ''}`}>{ai[t].toFixed(2)}</span>}
          </button>
        ))}
      </div>
      {ai ? (
        <div className="tag-ai">
          <span className="muted small">
            AI 제안({scoreSource === 'image' ? '그림으로 판단' : scoreSource === 'text' ? '해설로 판단 · 참고용' : '분석 입력 기록 없음'}):{' '}
            {suggested.length ? suggested.map((t) => TASTE_LABEL[t]).join(' · ') : '0.5 이상인 태그 없음'}
          </span>
          {w.tagStatus === 'confirmed' ? (
            <>
              <span className="muted small">확정됨 — 추천에 AI 점수가 쓰여요. 태그를 바꾸고 저장하면 바꾼 태그는 켬 1 / 끔 0으로 반영돼요.</span>
              <span className="a-inline">
                <button type="button" className="a-btn sm" onClick={() => run({ tagStatus: 'suggested' }, '태그 확정을 해제했어요. 추천에는 켠 태그만 쓰여요.')}>
                  확정 해제
                </button>
              </span>
            </>
          ) : (
            <span className="a-inline">
              <button type="button" className="a-btn sm" onClick={() => setW((cur) => cur && { ...cur, tags: suggested })}>
                AI 제안대로 켜기
              </button>
              <button
                type="button"
                className="a-btn sm primary"
                onClick={() => run({ tagStatus: 'confirmed' }, '태그를 확정했어요. 이제 추천에 AI 점수가 쓰여요.')}
              >
                태그 확정 (켠 태그 기준)
              </button>
            </span>
          )}
        </div>
      ) : (
        <span className="muted small">아래 「AI 분석 실행」을 하면 AI가 태그마다 점수를 매겨 제안해요. 지금은 켠 태그만 추천에 쓰여요.</span>
      )}
      {msg && <p className={msg.type === 'ok' ? 'ok-text' : 'error-text'}>{msg.text}</p>}
    </div>
  );
}
