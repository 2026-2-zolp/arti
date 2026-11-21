/** A-03 전시 관리 — 전시 목록, 등록·수정 모달, 전시 행을 누르면 그 전시의 작품 관리로 이동 */
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api, uploadedImageUrl } from '../../api/client';
import { useConfirm } from '../../components/Confirmation';
import { useAsync } from '../../lib/useAsync';
import { useProtectedImage } from '../../lib/useProtectedImage';
import type { Exhibition, ExhibitionStatus } from '../../types';
import { EX_STATUS_LABEL, PageHead } from './AdminLayout';

const blank = (): Exhibition => ({
  id: '',
  title: '',
  subtitle: '',
  venue: '',
  startDate: '',
  endDate: '',
  status: 'draft',
  entrance: { x: 50, y: 99 },
  floorPlan: null,
  rooms: [
    { id: 'r1', name: '1전시실', rect: { x: 3, y: 3, w: 45, h: 43 } },
    { id: 'r2', name: '2전시실', rect: { x: 52, y: 3, w: 45, h: 43 } },
  ],
});

/** 전시를 등록·조회·수정하는 화면 */
export default function A03Exhibitions() {
  const navigate = useNavigate();
  const { data, reload } = useAsync(() => Promise.all([api.listAdminExhibitions(), api.listAdminArtworks()]), []);
  const addButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<Exhibition | null>(null);
  const [posterFor, setPosterFor] = useState<Exhibition | null>(null);
  const [notice, setNotice] = useState('');

  const save = async (ex: Exhibition) => {
    await api.saveExhibition(ex);
    setEditing(null);
    reload();
  };

  const remove = async (id: string, version: number) => {
    await api.deleteExhibition(id, version);
    setEditing(null);
    setNotice('전시를 삭제했어요.');
    addButton.current?.focus();
    reload();
  };

  return (
    <>
      <PageHead
        title="전시 관리"
        desc="MVP 대상 전시의 기본 정보와 운영 상태, 전시별 작품 구성을 관리합니다."
        actions={
          <button ref={addButton} className="a-btn primary" onClick={() => { setNotice(''); setEditing(blank()); }}>
            + 전시 등록
          </button>
        }
      />
      {notice && <p role="status">{notice}</p>}
      <div className="a-card">
        <table className="a-table">
          <thead>
            <tr>
              <th>전시명</th>
              <th>기간</th>
              <th>장소</th>
              <th className="a-center">작품 수</th>
              <th className="a-center">운영 상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.[0].map((ex) => {
              const openArtworks = () => navigate(`/admin/artworks?exhibition=${ex.id}`);
              return (
                // 행을 누르면 그 전시의 작품 관리로 이동한다(예전 [작품 관리] 버튼과 같은 이동). 키보드는 전시명 링크로 이동.
                <tr key={ex.id} className="clickable" onClick={openArtworks}>
                  <td>
                    <Link to={`/admin/artworks?exhibition=${ex.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{ex.title}</strong>
                    </Link>
                    {ex.subtitle && <div className="muted small a-ex-sub">{ex.subtitle}</div>}
                  </td>
                  <td className="nowrap">
                    {ex.startDate} ~ {ex.endDate}
                  </td>
                  <td>{ex.venue}</td>
                  <td className="a-center">{data[1].filter((w) => w.exhibitionId === ex.id).length}</td>
                  <td className="a-center">
                    <span className={`badge ${ex.status}`}>{EX_STATUS_LABEL[ex.status]}</span>
                  </td>
                  <td className="actions">
                    <div className="a-actions">
                      <button
                        className="a-btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNotice('');
                          setEditing(ex);
                        }}
                      >
                        수정
                      </button>
                      <button className="a-btn sm" type="button" aria-label={`${ex.title} 포스터 관리`}
                        onClick={e => { e.stopPropagation(); setPosterFor(ex); }}>
                        포스터
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && <ExhibitionModal initial={editing} hasArtworks={data?.[1].some((work) => work.exhibitionId === editing.id) ?? false}
        onClose={() => setEditing(null)} onSave={save} onDelete={remove} onRefresh={reload} />}
      {posterFor && <ExhibitionPosterModal initial={posterFor} onClose={() => setPosterFor(null)} onSaved={reload} />}
    </>
  );
}

function ExhibitionPosterModal({ initial: ex, onClose, onSaved }: { initial: Exhibition; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { src, failed } = useProtectedImage(ex.posterFile ? uploadedImageUrl(ex.posterFile, true) : undefined);

  const changePoster = async (nextFile?: File) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!nextFile && !(await confirm('전시 포스터를 삭제할까요?'))) return;
      if (nextFile) await api.uploadExhibitionPoster(ex.id, nextFile, ex.version);
      else await api.deleteExhibitionPoster(ex.id, ex.version);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '포스터를 저장하지 못했어요.');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <form className="modal poster-modal" role="dialog" aria-modal="true" aria-labelledby="exhibition-poster-heading"
        onClick={e => e.stopPropagation()} onKeyDown={e => {
          if (e.key === 'Escape' && !busy) onClose();
        }} onSubmit={e => {
        e.preventDefault();
        if (file) void changePoster(file);
      }}>
        <h2 id="exhibition-poster-heading">{ex.title} 포스터</h2>
        <p className="muted small">운영 중인 전시의 관람 시작 화면에 표시해요. 사용 허가를 받은 이미지를 올려 주세요.</p>
        {src && <img className="hero-illust exhibition-poster" src={src} alt="현재 포스터" />}
        {failed && <p className="muted small">현재 포스터를 불러오지 못했어요.</p>}
        <label className="a-field">
          <span>포스터 파일</span>
          <input type="file" autoFocus accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => setFile(e.target.files?.[0])} />
        </label>
        <p className="muted small">PNG, JPG, WEBP · 최대 10MB</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          {ex.posterFile && <button type="button" className="a-btn" disabled={busy} onClick={() => void changePoster()}>포스터 삭제</button>}
          <button type="button" className="a-btn" disabled={busy} onClick={onClose}>닫기</button>
          <button className="a-btn primary" disabled={busy || !file}>포스터 저장</button>
        </div>
      </form>
    </div>
  );
}

/** 전시 등록·수정 입력을 모아 저장합니다. */
function ExhibitionModal({
  initial,
  hasArtworks,
  onClose,
  onSave,
  onDelete,
  onRefresh,
}: {
  initial: Exhibition;
  hasArtworks: boolean;
  onClose: () => void;
  onSave: (ex: Exhibition) => Promise<void>;
  onDelete: (id: string, version: number) => Promise<void>;
  onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const [ex, setEx] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const set = <K extends keyof Exhibition>(k: K, v: Exhibition[K]) => setEx((e) => ({ ...e, [k]: v }));
  const deletionBlock = initial.status === 'running' ? '전시를 종료하거나 준비 중으로 저장한 뒤 삭제할 수 있어요.'
    : hasArtworks ? '등록된 작품을 다른 전시로 옮기거나 정리한 뒤 삭제할 수 있어요.' : '';

  const mutate = async (operation: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.code === 'VERSION_CONFLICT')) {
        setStale(true);
        setError('전시가 변경됐어요. 창을 닫고 목록에서 최신 전시를 확인해 주세요.');
        onRefresh();
      } else {
        setError(e instanceof Error ? e.message : fallback);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || stale) return;
    if (!ex.title.trim() || !ex.startDate || !ex.endDate) return setError('전시명과 기간은 필수입니다.');
    if (ex.endDate < ex.startDate) return setError('종료일이 시작일보다 빠를 수 없어요.');
    void mutate(() => onSave(ex), '전시를 저장하지 못했어요.');
  };

  const remove = async () => {
    const { id, title, version } = initial;
    if (!id || version === undefined || busy || stale || deletionBlock) return;
    if (!await confirm(`「${title}」 전시를 삭제할까요? 삭제한 전시는 되돌릴 수 없어요.`, {
      title: '전시 삭제', confirm: '전시 삭제', tone: 'danger',
    })) return;
    await mutate(() => onDelete(id, version), '전시를 삭제하지 못했어요.');
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="exhibition-editor-heading"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }} onSubmit={submit}>
        <h2 id="exhibition-editor-heading">{initial.id ? '전시 수정' : '전시 등록'}</h2>
        <label className="a-field">
          <span>전시명</span>
          <input autoFocus value={ex.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="a-field">
          <span>부제</span>
          <input value={ex.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
        </label>
        <label className="a-field">
          <span>장소</span>
          <input value={ex.venue} onChange={(e) => set('venue', e.target.value)} />
        </label>
        <div className="a-row">
          <label className="a-field">
            <span>시작일</span>
            <input type="date" value={ex.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label className="a-field">
            <span>종료일</span>
            <input type="date" value={ex.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </label>
        </div>
        <label className="a-field">
          <span>운영 상태</span>
          <select value={ex.status} onChange={(e) => set('status', e.target.value as ExhibitionStatus)}>
            {(Object.keys(EX_STATUS_LABEL) as ExhibitionStatus[]).map((s) => (
              <option key={s} value={s}>
                {EX_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {initial.id && deletionBlock && <p className="muted small">{deletionBlock}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          {initial.id && <button type="button" className="a-btn" disabled={busy || stale || !!deletionBlock || initial.version === undefined}
            onClick={() => void remove()}>전시 삭제</button>}
          <button type="button" className="a-btn" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button className="a-btn primary" disabled={busy || stale}>저장</button>
        </div>
      </form>
    </div>
  );
}
