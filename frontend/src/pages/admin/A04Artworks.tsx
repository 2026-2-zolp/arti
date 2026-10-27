/**
 * A-04 작품 등록·수정
 * - /admin/artworks        : 작품 목록 (전시·검수 상태 필터)
 * - /admin/artworks/new    : 새 작품 등록
 * - /admin/artworks/:id    : 작품 수정
 * 작품 해설과 AI 응답 데이터의 신뢰성을 위해 출처·참고자료·검수 상태를 함께 관리한다.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { AI_STATUS_LABEL, TAG_KEYS, TAG_THRESHOLD, TASTE_LABEL } from '../../data/mock';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { EmotionBars } from '../../components/EmotionBars';
import type { AiStatus, Artwork, ReviewStatus, TasteTag } from '../../types';
import { PageHead, REVIEW_LABEL } from './AdminLayout';

export function ArtworkList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const exFilter = params.get('exhibition') ?? '';
  const reviewFilter = params.get('review') ?? '';
  const { data, reload } = useAsync(() => Promise.all([api.listExhibitions(), api.listArtworks()]), []);
  const [busy, setBusy] = useState<'analyze' | 'confirm' | null>(null);
  const [aiMsg, setAiMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  // 일괄 작업 대상 전시: 필터로 고른 전시, 없으면 운영 중인 전시
  const targetEx = data?.[0].find((e) => e.id === exFilter) ?? data?.[0].find((e) => e.status === 'running');

  const analyzeAll = async () => {
    if (!targetEx) return;
    setBusy('analyze');
    setAiMsg(null);
    try {
      const r = await api.analyzeExhibition(targetEx.id);
      setAiMsg(
        r.errors.length
          ? { type: 'err', text: `${r.analyzed}/${r.total}점 분석 완료 · 실패: ${r.errors.join(' / ')}` }
          : { type: 'ok', text: `「${targetEx.title}」 작품 ${r.analyzed}점을 분석했어요. 결과를 확인한 뒤 확정해 주세요.` },
      );
      reload();
    } catch (e) {
      setAiMsg({ type: 'err', text: e instanceof Error ? e.message : '분석에 실패했어요.' });
    } finally {
      setBusy(null);
    }
  };

  const confirmAll = async () => {
    if (!targetEx || !confirm(`「${targetEx.title}」의 AI 제안(취향 태그·감정 분석·요약)을 모두 확정할까요? 태그는 AI가 "해당함"으로 본 태그가 켜져요.`)) return;
    setBusy('confirm');
    try {
      const r = await api.confirmExhibitionAi(targetEx.id);
      setAiMsg({ type: 'ok', text: `작품 ${r.confirmed}점의 AI 결과를 확정했어요. 이제 추천·작품 화면에 반영됩니다.` });
      reload();
    } finally {
      setBusy(null);
    }
  };

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const rows = (data?.[1] ?? []).filter(
    (w) =>
      (!exFilter || w.exhibitionId === exFilter) &&
      (!reviewFilter || (reviewFilter === 'todo' ? w.reviewStatus !== 'approved' : w.reviewStatus === reviewFilter)),
  );
  const roomName = (w: Artwork) =>
    data?.[0].find((e) => e.id === w.exhibitionId)?.rooms.find((r) => r.id === w.roomId)?.name ?? '-';

  return (
    <>
      <PageHead
        title="작품 관리"
        desc="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <>
            <button className="a-btn" disabled={!targetEx || busy !== null} onClick={analyzeAll}>
              {busy === 'analyze' ? 'AI 분석 중… (작품당 수 초)' : '전시 AI 일괄 분석'}
            </button>
            <button className="a-btn" disabled={!targetEx || busy !== null} onClick={confirmAll}>
              AI 제안 모두 확정
            </button>
            <button className="a-btn primary" onClick={() => navigate(`/admin/artworks/new${exFilter ? `?exhibition=${exFilter}` : ''}`)}>
              + 작품 등록
            </button>
          </>
        }
      />
      {aiMsg && <p className={aiMsg.type === 'ok' ? 'ok-text' : 'error-text'} style={{ marginBottom: 14 }}>{aiMsg.text}</p>}
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
        <span className="muted small">{rows.length}건</span>
      </div>
      <div className="a-card">
        <table className="a-table">
          <thead>
            <tr>
              <th style={{ width: 64 }} />
              <th>작품명</th>
              <th>작가</th>
              <th>연도</th>
              <th>전시실</th>
              <th>위치</th>
              <th>검수 상태</th>
              <th>AI 감정·요약</th>
              <th>수정일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => navigate(`/admin/artworks/${w.id}`)}>
                <td>
                  <ArtImage className="a-thumb" seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w, true)} alt="" ratio={1} />
                </td>
                <td>
                  <strong>{w.title}</strong>
                </td>
                <td>{w.artist}</td>
                <td>{w.year}</td>
                <td>{roomName(w)}</td>
                <td>{w.position ? '등록' : <span className="text-warn">미등록</span>}</td>
                <td>
                  <span className={`badge ${w.reviewStatus}`}>{REVIEW_LABEL[w.reviewStatus]}</span>
                </td>
                <td>
                  <span className={`badge ai-${w.tagStatus}`}>태그 {AI_STATUS_LABEL[w.tagStatus]}</span>{' '}
                  <span className={`badge ai-${w.emotionStatus}`}>감정 {AI_STATUS_LABEL[w.emotionStatus]}</span>{' '}
                  <span className={`badge ai-${w.summaryStatus}`}>요약 {AI_STATUS_LABEL[w.summaryStatus]}</span>
                </td>
                <td>{w.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  source: '',
  referenceUrl: '',
  reviewStatus: 'pending',
  updatedAt: '',
  analysis: null,
  emotionStatus: 'none',
  summary: '',
  summaryKeywords: [],
  summaryStatus: 'none',
  imageFile: null,
  showImage: true,
});

export function ArtworkEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const { data } = useAsync(
    () => Promise.all([api.listExhibitions(), isNew ? Promise.resolve(null) : api.getArtwork(id!)]),
    [id],
  );
  const [w, setW] = useState<Artwork | null>(null);
  const [guided, setGuided] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    const initial = data[1] ?? emptyArtwork(params.get('exhibition') ?? data[0][0]?.id ?? '');
    setW(initial);
    setGuided(initial.guidedLooking.join('\n'));
  }, [data, params]);

  if (!data || !w) return <PageHead title="작품 등록·수정" desc="불러오는 중…" />;

  const exhibitions = data[0];
  const rooms = exhibitions.find((e) => e.id === w.exhibitionId)?.rooms ?? [];
  const set = <K extends keyof Artwork>(k: K, v: Artwork[K]) => setW((cur) => (cur ? { ...cur, [k]: v } : cur));
  const toggleTag = (t: TasteTag) => set('tags', w.tags.includes(t) ? w.tags.filter((x) => x !== t) : [...w.tags, t]);

  /** 입력 중인 내용과 함께 바로 저장 (태그 확정·해제 버튼용) */
  const saveWith = async (patch: Partial<Artwork>) => {
    const saved = await api.saveArtwork({ ...w, ...patch, guidedLooking: guided.split('\n').map((s) => s.trim()).filter(Boolean) });
    setW(saved);
    return saved;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!w.title.trim() || !w.artist.trim()) return setMsg({ type: 'err', text: '작품명과 작가는 필수입니다.' });
    if (w.reviewStatus === 'approved' && (!w.source.trim() || !w.description.trim()))
      return setMsg({ type: 'err', text: '검수 완료로 저장하려면 작품 해설과 출처가 있어야 해요.' });
    let saved: Artwork;
    try {
      saved = await api.saveArtwork({
        ...w,
        guidedLooking: guided.split('\n').map((s) => s.trim()).filter(Boolean),
      });
    } catch (err) {
      return setMsg({ type: 'err', text: err instanceof Error ? err.message : '저장하지 못했어요.' });
    }
    setW(saved);
    setMsg({
      type: 'ok',
      text:
        saved.emotionStatus !== w.emotionStatus || saved.summaryStatus !== w.summaryStatus || saved.tagStatus !== w.tagStatus
          ? '저장했습니다. 공식 해설이나 이미지가 바뀌어 AI 결과를 다시 확인해야 해요(「AI 제안」으로 변경).'
          : '저장했습니다.',
    });
    if (isNew) navigate(`/admin/artworks/${saved.id}`, { replace: true });
  };

  return (
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
          <ImageField w={w} setW={setW} set={set} />
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
            <span>작품 해설</span>
            <textarea rows={6} value={w.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="a-field">
            <span>Guided Looking 질문 (한 줄에 하나)</span>
            <textarea rows={4} value={guided} onChange={(e) => setGuided(e.target.value)} />
          </label>
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
            <button className="a-btn primary save">저장</button>
          </div>
          {msg && <p className={msg.type === 'ok' ? 'ok-text' : 'error-text'}>{msg.text}</p>}
          <p className="muted small">검수 완료 + 위치 등록된 작품만 사용자 추천에 노출됩니다.</p>
        </section>
      </div>
      {w.id ? (
        <AiPanel w={w} setW={setW} />
      ) : (
        <p className="muted small mt-24">작품을 먼저 저장하면 AI 감정 분석·해설 요약을 실행할 수 있어요.</p>
      )}
    </form>
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
}: {
  w: Artwork;
  setW: (f: (cur: Artwork | null) => Artwork | null) => void;
  set: <K extends keyof Artwork>(k: K, v: Artwork[K]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const src = artworkImageSrc(w, true);

  // 서버가 바꾼 필드만 반영하고, 화면에서 수정 중인 다른 입력값은 그대로 둔다
  const applyServer = (saved: Artwork) =>
    setW((cur) =>
      cur && {
        ...cur,
        imageFile: saved.imageFile,
        emotionStatus: saved.emotionStatus,
        summaryStatus: saved.summaryStatus,
        updatedAt: saved.updatedAt,
      },
    );

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setErr('PNG, JPG, WEBP 이미지만 올릴 수 있어요.');
    if (file.size > 10 * 1024 * 1024) return setErr('이미지는 10MB 이하로 올려 주세요.');
    setBusy(true);
    setErr(null);
    try {
      applyServer(await api.uploadArtworkImage(w.id, file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '업로드에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async () => {
    if (!confirm('올린 이미지 파일을 삭제할까요?')) return;
    applyServer(await api.deleteArtworkImage(w.id));
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
          {src ? <img src={src} alt="작품 이미지 미리보기" /> : <div className="img-empty">이미지 없음</div>}
          <div className="img-drop-actions">
            <label className="a-btn sm">
              {busy ? '올리는 중…' : w.imageFile ? '다른 이미지로 바꾸기' : '이미지 파일 올리기'}
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
              <button type="button" className="a-btn sm" onClick={removeFile}>
                파일 삭제
              </button>
            )}
            <span className="muted small">캡처 이미지를 끌어다 놓아도 돼요 (PNG·JPG·WEBP, 10MB 이하)</span>
          </div>
        </div>
      ) : (
        <p className="muted small">작품을 먼저 저장하면 이미지 파일을 올릴 수 있어요.</p>
      )}
      {err && <p className="error-text">{err}</p>}
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
 * - 「AI 분석 실행」: 저장된 해설(+이미지)로 취향 태그·감정 분석(오픈소스 모델) + 해설 요약(Claude) → 「AI 제안」
 * - 관리자가 결과를 확인·수정한 뒤 「확정」해야 사용자 화면과 추천에 쓰인다
 * - 취향 태그 제안은 「기본 정보」의 태그 버튼(TagField)에 표시하고, 여기서는 감정(설명용)·요약을 다룬다
 */
function AiPanel({ w, setW }: { w: Artwork; setW: (f: (cur: Artwork | null) => Artwork | null) => void }) {
  const [useImage, setUseImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.analyzeArtwork(w.id, useImage);
      // 화면에서 수정 중인 다른 입력값은 유지하고 AI 결과 필드만 바꾼다
      setW((cur) =>
        cur && {
          ...cur,
          analysis: r.artwork.analysis,
          tagStatus: r.artwork.tagStatus,
          tagScores: r.artwork.tagScores,
          emotionStatus: r.artwork.emotionStatus,
          summary: r.artwork.summary,
          summaryKeywords: r.artwork.summaryKeywords,
          summaryStatus: r.artwork.summaryStatus,
          updatedAt: r.artwork.updatedAt,
        },
      );
      const notes = [
        r.emotion.ok ? '취향 태그·감정 분석 완료 (태그 제안은 위 「취향 태그」에서 확인)' : `AI 분석 실패: ${r.emotion.error}`,
        r.summary.ok
          ? r.summary.source === 'claude'
            ? '요약 완료(Claude)'
            : '요약: Claude API 키가 없어 원문 앞부분으로 대신했어요'
          : `요약 실패: ${r.summary.error}`,
      ];
      setMsg({ type: r.emotion.ok ? 'ok' : 'err', text: notes.join(' · ') });
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'AI 분석에 실패했어요.' });
    } finally {
      setBusy(false);
    }
  };

  /** 확정/해제는 바로 서버에 저장 */
  const setStatus = async (patch: Partial<Pick<Artwork, 'emotionStatus' | 'summaryStatus'>>) => {
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
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '저장하지 못했어요.' });
    }
  };

  const badge = (s: AiStatus) => <span className={`badge ai-${s}`}>{AI_STATUS_LABEL[s]}</span>;
  const a = w.analysis;

  return (
    <section className="a-card pad ai-panel">
      <div className="ai-panel-head">
        <div>
          <h2>AI 분석 · 요약</h2>
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
          <button type="button" className="a-btn primary" disabled={busy} onClick={run}>
            {busy ? 'AI 분석 중…' : a || w.summary ? 'AI 다시 분석' : 'AI 분석 실행'}
          </button>
        </div>
      </div>
      {msg && <p className={msg.type === 'ok' ? 'ok-text' : 'error-text'} style={{ marginBottom: 14 }}>{msg.text}</p>}

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
                분석 시각: {a.analyzedAt.slice(0, 16).replace('T', ' ')}
              </p>
              <div className="ai-actions">
                {w.emotionStatus !== 'confirmed' ? (
                  <button type="button" className="a-btn sm primary" onClick={() => setStatus({ emotionStatus: 'confirmed' })}>
                    감정 분석 확정
                  </button>
                ) : (
                  <button type="button" className="a-btn sm" onClick={() => setStatus({ emotionStatus: 'suggested' })}>
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
            <h3>초보자용 해설 요약</h3>
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
                disabled={!w.summary.trim()}
                onClick={() => setStatus({ summaryStatus: 'confirmed' })}
              >
                요약 확정 (수정 내용 포함 저장)
              </button>
            ) : (
              <button type="button" className="a-btn sm" onClick={() => setStatus({ summaryStatus: 'suggested' })}>
                확정 해제
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
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
  const ai = w.analysis?.tags ?? null;
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
            AI 제안({w.analysis?.tagSource === 'image' ? '그림으로 판단' : '그림이 없어 해설로 판단 · 참고용'}):{' '}
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
