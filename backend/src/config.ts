/** 환경 변수 설정 (.env 또는 셸 환경에서 읽는다) */
const env = process.env;

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());

export const config = {
  port: Number(env.PORT ?? 4000),
  dbPath: env.DB_PATH || 'data/arti.db',
  /** 데모 모드: 재설정 링크를 응답으로 돌려준다. 운영(NODE_ENV=production)에서는 기본 false */
  demoMode: bool(env.DEMO_MODE, env.NODE_ENV !== 'production'),
  sessionTtlMs: Number(env.SESSION_TTL_DAYS ?? 14) * 24 * 60 * 60 * 1000,
  resetTokenTtlMs: 30 * 60 * 1000,
  corsOrigin: env.CORS_ORIGIN || '',
  /** 로그인·AI 요청 횟수 제한. 테스트에서만 RATE_LIMIT=off */
  rateLimit: env.RATE_LIMIT !== 'off',
  /** 감정 분석 서버(ai-service) 주소 */
  emotionServiceUrl: (env.EMOTION_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, ''),
  /** 첫 분석 때 모델 로딩까지 기다릴 수 있도록 넉넉하게 */
  emotionTimeoutMs: Number(env.EMOTION_TIMEOUT_MS ?? 180_000),
  ai: {
    /** API 키가 있으면 Claude, 없으면 규칙 기반 답변 */
    enabled: Boolean(env.ANTHROPIC_API_KEY),
    model: env.ARTI_AI_MODEL || 'claude-opus-5-5',
  },
};
