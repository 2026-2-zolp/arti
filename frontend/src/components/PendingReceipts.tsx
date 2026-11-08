/** 저장하지 못한 회원 관람 기록의 명시적 복구를 안내합니다. */
import {useConfirm} from './Confirmation';
import {useState, useRef, useEffect} from 'react';
import {api} from '../api/client';
import {useVisit} from '../store/VisitContext';
import {load, remove} from '../lib/storage';
import type {VisitRecord} from '../types';
/** 저장하지 못한 회원 관람 기록의 명시적 복구를 안내합니다. */
export function PendingReceipts({onRecovered}: {onRecovered?: () => void}) {
 const confirmAction = useConfirm();
 const {state} = useVisit(); const [revision, setRevision] = useState(0); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
 const currentActor = useRef(state.user?.id); currentActor.current = state.user?.id;
 const active = useRef(true); useEffect(() => {active.current = true; return () => {active.current = false;};}, []);
 const prefix = `arti.pendingReceipt.${state.user?.id}.`;
 const keys = Object.keys(sessionStorage).filter(k => k.startsWith(prefix));
 const recover = async (key: string) => {
  const record = load<Omit<VisitRecord, 'id'> | null>(key, null, 'session'); if (!record || !state.user || record.userId !== state.user.id || busy) return;
  if (!(await confirmAction('이 계정의 미저장 관람기록을 원래 내용 그대로 저장할까요? 현재 관람에는 합치지 않습니다.'))) return;
  setBusy(true); setMessage('');
  try {const result = await api.saveMemberVisit(record, state.user.id, () => active.current && currentActor.current === record.userId); if (!active.current || currentActor.current !== record.userId) return; if (!result.persisted) throw new Error('저장 결과를 확인할 수 없어요.'); remove(key, 'session'); setMessage('미저장 기록을 복구했어요.'); setRevision(revision+1); onRecovered?.();}
  catch (e) {setMessage(e instanceof Error ? e.message : '복구에 실패했어요.');} finally {setBusy(false);}
 };
 return <section aria-label="미저장 기록 복구">{keys.map(key => <p key={key}>이 탭에 미저장 관람기록이 있어요. {load<VisitRecord | null>(key, null, 'session')?.exhibitionTitle} · {load<VisitRecord | null>(key, null, 'session')?.viewedArtworkIds.length}점 <button disabled={busy} onClick={() => recover(key)}>기록 확인 후 복구</button><button disabled={busy} onClick={async () => {if (await confirmAction('미저장 기록을 버릴까요?')) {remove(key, 'session');setRevision(revision+1);}}}>버리기</button></p>)}{message && <p role="status">{message}</p>}</section>;
}
