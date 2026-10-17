/** 서버 진입점: DB를 열고(없으면 생성·초기 데이터 입력) API 서버를 띄운다 */
import { createApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db.js';

const db = openDb(config.dbPath);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`ARTI API 서버 실행 중: http://localhost:${config.port}/api`);
  console.log(`- DB: ${config.dbPath}`);
  console.log(`- AI: ${config.ai.enabled ? `Claude (${config.ai.model})` : '규칙 기반 (ANTHROPIC_API_KEY 미설정)'}`);
  if (config.demoMode) console.log('- 데모 모드: 비밀번호 재설정 링크를 응답으로 돌려줍니다. 운영 시 DEMO_MODE=false');
});
