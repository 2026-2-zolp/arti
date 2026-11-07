/** A-01 관리자 로그인 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { save } from '../../lib/storage';
import { ADMIN_KEY, isAdminLoggedIn } from './AdminLayout';

export default function A01Login() {
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAdminLoggedIn()) return <Navigate to="/admin" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const admin = await api.adminLogin(id, pw);
      save(ADMIN_KEY, admin);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={onSubmit}>
        <div className="admin-brand">
          <strong>ARTI</strong>
          <span>관리자</span>
        </div>
        <h1>관리자 로그인</h1>
        <label className="a-field">
          <span>관리자 ID</span>
          <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" />
        </label>
        <label className="a-field">
          <span>비밀번호</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="a-btn primary block" disabled={submitting || !id || !pw}>
          {submitting ? '확인 중…' : '로그인'}
        </button>
        <p className="demo-hint">데모: admin / admin1234</p>
      </form>
    </div>
  );
}
