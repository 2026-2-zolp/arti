/** A-03 전시 관리 — 전시 목록, 등록·수정 모달, 전시별 작품 관리로 이동 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
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
  rooms: [
    { id: 'r1', name: '1전시실', rect: { x: 3, y: 3, w: 45, h: 43 } },
    { id: 'r2', name: '2전시실', rect: { x: 52, y: 3, w: 45, h: 43 } },
  ],
});

export default function A03Exhibitions() {
  const navigate = useNavigate();
  const { data, reload } = useAsync(() => Promise.all([api.listExhibitions(), api.listArtworks()]), []);
  const [editing, setEditing] = useState<Exhibition | null>(null);

  const save = async (ex: Exhibition) => {
    await api.saveExhibition(ex);
    setEditing(null);
    reload();
  };

  return (
    <>
      <PageHead
        title="전시 관리"
        desc="MVP 대상 전시의 기본 정보와 운영 상태, 전시별 작품 구성을 관리합니다."
        actions={
          <button className="a-btn primary" onClick={() => setEditing(blank())}>
            + 전시 등록
          </button>
        }
      />
      <div className="a-card">
        <table className="a-table">
          <thead>
            <tr>
              <th>전시명</th>
              <th>기간</th>
              <th>장소</th>
              <th>작품 수</th>
              <th>운영 상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.[0].map((ex) => (
              <tr key={ex.id}>
                <td>
                  <strong>{ex.title}</strong>
                  <div className="muted small">{ex.subtitle}</div>
                </td>
                <td>
                  {ex.startDate} ~ {ex.endDate}
                </td>
                <td>{ex.venue}</td>
                <td>{data[1].filter((w) => w.exhibitionId === ex.id).length}</td>
                <td>
                  <span className={`badge ${ex.status}`}>{EX_STATUS_LABEL[ex.status]}</span>
                </td>
                <td className="actions">
                  <button className="a-btn sm" onClick={() => setEditing(ex)}>
                    수정
                  </button>
                  <button className="a-btn sm" onClick={() => navigate(`/admin/artworks?exhibition=${ex.id}`)}>
                    작품 관리
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <ExhibitionModal initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function ExhibitionModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Exhibition;
  onClose: () => void;
  onSave: (ex: Exhibition) => void;
}) {
  const [ex, setEx] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Exhibition>(k: K, v: Exhibition[K]) => setEx((e) => ({ ...e, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ex.title.trim() || !ex.startDate || !ex.endDate) return setError('전시명과 기간은 필수입니다.');
    if (ex.endDate < ex.startDate) return setError('종료일이 시작일보다 빠를 수 없어요.');
    onSave(ex);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{initial.id ? '전시 수정' : '전시 등록'}</h2>
        <label className="a-field">
          <span>전시명</span>
          <input value={ex.title} onChange={(e) => set('title', e.target.value)} />
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
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="a-btn" onClick={onClose}>
            취소
          </button>
          <button className="a-btn primary">저장</button>
        </div>
      </form>
    </div>
  );
}
