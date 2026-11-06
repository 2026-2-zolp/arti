/**
 * SQLite 데이터베이스 (Node.js 내장 node:sqlite 사용 — 별도 설치·네이티브 빌드 불필요)
 *
 * 배열·객체 필드(tags, rooms, position 등)는 JSON 문자열 컬럼으로 저장한다.
 * DB 파일이 비어 있으면 seed.ts의 목업 데이터로 초기화한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './lib/password.js';
import { migrateTagList } from './lib/tags.js';
import { seedArtworks, seedExhibitions, seedUsers, seedVisits } from './seed.js';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS exhibitions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  venue       TEXT NOT NULL DEFAULT '',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('draft','running','closed')),
  rooms       TEXT NOT NULL DEFAULT '[]',   -- JSON Room[]
  entrance    TEXT NOT NULL                 -- JSON MapPoint
);

CREATE TABLE IF NOT EXISTS artworks (
  id             TEXT PRIMARY KEY,
  exhibition_id  TEXT NOT NULL REFERENCES exhibitions(id),
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL,
  year           TEXT NOT NULL DEFAULT '',
  room_id        TEXT NOT NULL DEFAULT '',
  position       TEXT,                      -- JSON MapPoint | NULL(위치 미등록)
  palette        TEXT NOT NULL DEFAULT '[]',
  image_url      TEXT,
  tags           TEXT NOT NULL DEFAULT '[]',
  description    TEXT NOT NULL DEFAULT '',
  guided_looking TEXT NOT NULL DEFAULT '[]',
  source         TEXT NOT NULL DEFAULT '',
  reference_url  TEXT NOT NULL DEFAULT '',
  review_status  TEXT NOT NULL CHECK (review_status IN ('pending','source_check','approved')),
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artworks_exhibition ON artworks(exhibition_id);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL DEFAULT '',
  tastes        TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant'))
);

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  login_id      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL
);

-- 로그인 세션: 토큰 원문은 저장하지 않고 SHA-256 해시만 저장
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('user','admin')),
  subject_id  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(role, subject_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES users(id),
  exhibition_id             TEXT NOT NULL,
  exhibition_title          TEXT NOT NULL,
  venue                     TEXT NOT NULL,
  date                      TEXT NOT NULL,
  duration_min              INTEGER NOT NULL,
  viewed_artwork_ids        TEXT NOT NULL DEFAULT '[]',
  recommended_count         INTEGER NOT NULL,
  reactions                 TEXT NOT NULL DEFAULT '{}',
  longest_viewed_artwork_id TEXT,
  keywords                  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id, date);
`;

/** 관리자 기본 계정 (데모용). 운영 전에는 반드시 비밀번호를 바꾼다. */
export const DEFAULT_ADMIN = { id: 'admin-1', loginId: 'admin', password: 'admin1234', name: '관리자' };

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM exhibitions').get() as { n: number };
  if (n === 0) seed(db);
  return db;
}

/**
 * 기존 DB 파일에 나중에 추가된 컬럼을 붙인다 (이미 있으면 건너뜀).
 * 덕분에 db:reset 없이도 새 버전 서버로 바로 실행할 수 있다.
 */
const ADDED_COLUMNS: Record<string, [string, string][]> = {
  exhibitions: [
    ['floor_plan', 'TEXT'], // JSON FloorPlan | NULL
  ],
  artworks: [
    ['analysis', 'TEXT'], // JSON ArtworkAnalysis | NULL
    ["emotion_status", "TEXT NOT NULL DEFAULT 'none'"],
    ['summary', "TEXT NOT NULL DEFAULT ''"],
    ['summary_keywords', "TEXT NOT NULL DEFAULT '[]'"],
    ["summary_status", "TEXT NOT NULL DEFAULT 'none'"],
    ['image_file', 'TEXT'],
    ['show_image', 'INTEGER NOT NULL DEFAULT 1'],
    ['tag_scores', 'TEXT'], // JSON TagScores | NULL (AI 태그를 확정했을 때)
    ["tag_status", "TEXT NOT NULL DEFAULT 'none'"],
    ['guided_hints', "TEXT NOT NULL DEFAULT '[]'"],
    ['guide_intro', "TEXT NOT NULL DEFAULT ''"],
    ["guide_status", "TEXT NOT NULL DEFAULT 'none'"],
  ],
  visits: [
    ['interpretation', 'TEXT'],
    ['emotion_profile', 'TEXT'], // JSON EmotionScores | NULL
  ],
};

function migrate(db: DB) {
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const [name, def] of cols) {
      if (existing.has(name)) continue;
      // 초보자 가이드 상태(guide_status)는 기존 관찰 질문이 있어도 확정으로 옮기지 않고 'none'으로 시작한다
      // (관리자가 A-04에서 AI 분석 → 검토 → 확정해야 사용자 화면에 보임)
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    }
  }
  migrateLegacyTags(db);
}

/** 예전 취향 태그 6개(고요한 풍경·감정 표현 …)로 저장된 작품 태그·사용자 취향을 새 8개로 옮긴다 (calm→풍경, emotion은 삭제) */
function migrateLegacyTags(db: DB) {
  for (const [table, col] of [['artworks', 'tags'], ['users', 'tastes']] as const) {
    const rows = db.prepare(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%"calm"%' OR ${col} LIKE '%"emotion"%'`).all() as {
      id: string;
      v: string;
    }[];
    const update = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`);
    for (const r of rows) update.run(JSON.stringify(migrateTagList(JSON.parse(r.v) as string[])), r.id);
  }
}

/** 여러 쿼리를 하나의 트랜잭션으로 실행 */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const j = (v: unknown) => JSON.stringify(v);

function seed(db: DB) {
  tx(db, () => {
    const ex = db.prepare(
      `INSERT INTO exhibitions (id,title,subtitle,venue,start_date,end_date,status,rooms,entrance)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const e of seedExhibitions)
      ex.run(e.id, e.title, e.subtitle, e.venue, e.startDate, e.endDate, e.status, j(e.rooms), j(e.entrance));

    const aw = db.prepare(
      `INSERT INTO artworks (id,exhibition_id,title,artist,year,room_id,position,palette,image_url,tags,
        description,guided_looking,source,reference_url,review_status,updated_at,guided_hints,guide_intro,guide_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const w of seedArtworks)
      aw.run(
        w.id, w.exhibitionId, w.title, w.artist, w.year, w.roomId, w.position ? j(w.position) : null,
        j(w.palette), w.imageUrl ?? null, j(w.tags), w.description, j(w.guidedLooking), w.source,
        w.referenceUrl, w.reviewStatus, w.updatedAt, j(w.guidedHints), w.guideIntro, w.guideStatus,
      );

    const us = db.prepare(
      `INSERT INTO users (id,email,password_hash,nickname,tastes,created_at,status) VALUES (?,?,?,?,?,?,?)`,
    );
    for (const u of seedUsers)
      us.run(u.id, u.email, hashPassword(u.password), u.nickname, j(u.tastes), u.createdAt, u.status);

    const vs = db.prepare(
      `INSERT INTO visits (id,user_id,exhibition_id,exhibition_title,venue,date,duration_min,viewed_artwork_ids,
        recommended_count,reactions,longest_viewed_artwork_id,keywords) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const v of seedVisits)
      vs.run(
        v.id, v.userId!, v.exhibitionId, v.exhibitionTitle, v.venue, v.date, v.durationMin, j(v.viewedArtworkIds),
        v.recommendedCount, j(v.reactions), v.longestViewedArtworkId, j(v.keywords),
      );

    db.prepare('INSERT INTO admins (id,login_id,password_hash,name) VALUES (?,?,?,?)').run(
      DEFAULT_ADMIN.id, DEFAULT_ADMIN.loginId, hashPassword(DEFAULT_ADMIN.password), DEFAULT_ADMIN.name,
    );
  });
}
