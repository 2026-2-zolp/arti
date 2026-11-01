/**
 * 데이터 접근 계층: DB 행(row) ↔ 프론트엔드와 같은 도메인 타입(types.ts) 변환과 쿼리 모음.
 * 라우트에서는 SQL을 직접 쓰지 않고 이 함수들만 사용한다.
 */
import type { DB } from './db.js';
import { newId } from './lib/password.js';
import type { AiStatus, Artwork, Exhibition, TasteTag, User, VisitRecord } from './types.js';

type Row = Record<string, unknown>;
const parse = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const j = (v: unknown) => JSON.stringify(v);
export const today = () => new Date().toISOString().slice(0, 10);

// ───────────────────────── 전시 ─────────────────────────
const toExhibition = (r: Row): Exhibition => ({
  id: String(r.id),
  title: String(r.title),
  subtitle: String(r.subtitle),
  venue: String(r.venue),
  startDate: String(r.start_date),
  endDate: String(r.end_date),
  status: r.status as Exhibition['status'],
  rooms: parse(r.rooms),
  entrance: parse(r.entrance),
  floorPlan: r.floor_plan ? parse(r.floor_plan) : null,
});

export function listExhibitions(db: DB): Exhibition[] {
  return (db.prepare('SELECT * FROM exhibitions ORDER BY start_date').all() as Row[]).map(toExhibition);
}

export function getExhibition(db: DB, id: string): Exhibition | null {
  const r = db.prepare('SELECT * FROM exhibitions WHERE id = ?').get(id) as Row | undefined;
  return r ? toExhibition(r) : null;
}

export function upsertExhibition(db: DB, e: Exhibition): Exhibition {
  const saved = { ...e, id: e.id || newId('ex') };
  db.prepare(
    `INSERT INTO exhibitions (id,title,subtitle,venue,start_date,end_date,status,rooms,entrance,floor_plan)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle, venue=excluded.venue,
       start_date=excluded.start_date, end_date=excluded.end_date, status=excluded.status,
       rooms=excluded.rooms, entrance=excluded.entrance, floor_plan=excluded.floor_plan`,
  ).run(saved.id, saved.title, saved.subtitle, saved.venue, saved.startDate, saved.endDate, saved.status,
    j(saved.rooms), j(saved.entrance), saved.floorPlan ? j(saved.floorPlan) : null);
  return saved;
}

// ───────────────────────── 작품 ─────────────────────────
const toArtwork = (r: Row): Artwork => ({
  id: String(r.id),
  exhibitionId: String(r.exhibition_id),
  title: String(r.title),
  artist: String(r.artist),
  year: String(r.year),
  roomId: String(r.room_id),
  position: r.position == null ? null : parse(r.position),
  palette: parse(r.palette),
  ...(r.image_url ? { imageUrl: String(r.image_url) } : {}),
  imageFile: r.image_file == null ? null : String(r.image_file),
  showImage: r.show_image == null ? true : Number(r.show_image) === 1,
  tags: parse(r.tags),
  tagScores: r.tag_scores == null ? null : parse(r.tag_scores),
  tagStatus: (r.tag_status ?? 'none') as AiStatus,
  description: String(r.description),
  guidedLooking: parse(r.guided_looking),
  source: String(r.source),
  referenceUrl: String(r.reference_url),
  reviewStatus: r.review_status as Artwork['reviewStatus'],
  updatedAt: String(r.updated_at),
  analysis: r.analysis == null ? null : parse(r.analysis),
  emotionStatus: (r.emotion_status ?? 'none') as AiStatus,
  summary: String(r.summary ?? ''),
  summaryKeywords: parse(r.summary_keywords ?? '[]'),
  summaryStatus: (r.summary_status ?? 'none') as AiStatus,
  guidedHints: parse(r.guided_hints ?? '[]'),
  guideIntro: String(r.guide_intro ?? ''),
  guideStatus: (r.guide_status ?? 'none') as AiStatus,
});

export function listArtworks(db: DB, exhibitionId?: string): Artwork[] {
  const rows = exhibitionId
    ? db.prepare('SELECT * FROM artworks WHERE exhibition_id = ? ORDER BY id').all(exhibitionId)
    : db.prepare('SELECT * FROM artworks ORDER BY id').all();
  return (rows as Row[]).map(toArtwork);
}

export function getArtwork(db: DB, id: string): Artwork | null {
  const r = db.prepare('SELECT * FROM artworks WHERE id = ?').get(id) as Row | undefined;
  return r ? toArtwork(r) : null;
}

export function upsertArtwork(db: DB, w: Artwork): Artwork {
  const saved: Artwork = { ...w, id: w.id || newId('aw'), updatedAt: today() };
  db.prepare(
    `INSERT INTO artworks (id,exhibition_id,title,artist,year,room_id,position,palette,image_url,tags,
       description,guided_looking,source,reference_url,review_status,updated_at,
       analysis,emotion_status,summary,summary_keywords,summary_status,image_file,show_image,tag_scores,tag_status,
       guided_hints,guide_intro,guide_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET exhibition_id=excluded.exhibition_id, title=excluded.title,
       artist=excluded.artist, year=excluded.year, room_id=excluded.room_id, position=excluded.position,
       palette=excluded.palette, image_url=excluded.image_url, tags=excluded.tags,
       description=excluded.description, guided_looking=excluded.guided_looking, source=excluded.source,
       reference_url=excluded.reference_url, review_status=excluded.review_status, updated_at=excluded.updated_at,
       analysis=excluded.analysis, emotion_status=excluded.emotion_status, summary=excluded.summary,
       summary_keywords=excluded.summary_keywords, summary_status=excluded.summary_status,
       image_file=excluded.image_file, show_image=excluded.show_image,
       tag_scores=excluded.tag_scores, tag_status=excluded.tag_status,
       guided_hints=excluded.guided_hints, guide_intro=excluded.guide_intro, guide_status=excluded.guide_status`,
  ).run(
    saved.id, saved.exhibitionId, saved.title, saved.artist, saved.year, saved.roomId,
    saved.position ? j(saved.position) : null, j(saved.palette), saved.imageUrl || null, j(saved.tags),
    saved.description, j(saved.guidedLooking), saved.source, saved.referenceUrl, saved.reviewStatus, saved.updatedAt,
    saved.analysis ? j(saved.analysis) : null, saved.emotionStatus, saved.summary, j(saved.summaryKeywords),
    saved.summaryStatus, saved.imageFile, saved.showImage ? 1 : 0,
    saved.tagScores ? j(saved.tagScores) : null, saved.tagStatus,
    j(saved.guidedHints), saved.guideIntro, saved.guideStatus,
  );
  return saved;
}

// ───────────────────────── 회원 ─────────────────────────
export type UserRow = User & { passwordHash: string };

const toUser = (r: Row): UserRow => ({
  id: String(r.id),
  email: String(r.email),
  nickname: String(r.nickname),
  tastes: parse(r.tastes),
  createdAt: String(r.created_at),
  status: r.status as User['status'],
  passwordHash: String(r.password_hash),
});

/** 응답에 비밀번호 해시가 섞여 나가지 않도록 반드시 이 함수를 거친다 */
export const publicUser = ({ passwordHash: _h, ...u }: UserRow): User => u;

export function findUserByEmail(db: DB, email: string): UserRow | null {
  const r = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as Row | undefined;
  return r ? toUser(r) : null;
}

export function getUser(db: DB, id: string): UserRow | null {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
  return r ? toUser(r) : null;
}

export function createUser(db: DB, input: { email: string; passwordHash: string; nickname: string }): UserRow {
  const u: UserRow = {
    id: newId('u'),
    email: input.email.trim(),
    nickname: input.nickname.trim(),
    tastes: [],
    createdAt: today(),
    status: 'active',
    passwordHash: input.passwordHash,
  };
  db.prepare(
    'INSERT INTO users (id,email,password_hash,nickname,tastes,created_at,status) VALUES (?,?,?,?,?,?,?)',
  ).run(u.id, u.email, u.passwordHash, u.nickname, j(u.tastes), u.createdAt, u.status);
  return u;
}

export function updateUserTastes(db: DB, id: string, tastes: TasteTag[]) {
  db.prepare('UPDATE users SET tastes = ? WHERE id = ?').run(j(tastes), id);
}

export function updateUserPassword(db: DB, id: string, passwordHash: string) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function listMembers(db: DB, query: string) {
  const q = `%${query.trim().toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT u.*, COUNT(v.id) AS visit_count, MAX(v.date) AS last_visit
       FROM users u LEFT JOIN visits v ON v.user_id = u.id
       WHERE ? = '%%' OR lower(u.email) LIKE ? OR lower(u.nickname) LIKE ?
       GROUP BY u.id ORDER BY u.created_at DESC`,
    )
    .all(q, q, q) as Row[];
  return rows.map((r) => ({
    ...publicUser(toUser(r)),
    visitCount: Number(r.visit_count),
    lastVisit: r.last_visit == null ? null : String(r.last_visit),
  }));
}

// ───────────────────────── 관람 기록 ─────────────────────────
const toVisit = (r: Row): VisitRecord => ({
  id: String(r.id),
  userId: String(r.user_id),
  exhibitionId: String(r.exhibition_id),
  exhibitionTitle: String(r.exhibition_title),
  venue: String(r.venue),
  date: String(r.date),
  durationMin: Number(r.duration_min),
  viewedArtworkIds: parse(r.viewed_artwork_ids),
  recommendedCount: Number(r.recommended_count),
  reactions: parse(r.reactions),
  longestViewedArtworkId: r.longest_viewed_artwork_id == null ? null : String(r.longest_viewed_artwork_id),
  keywords: parse(r.keywords),
  interpretation: r.interpretation == null ? null : String(r.interpretation),
  emotionProfile: r.emotion_profile == null ? null : parse(r.emotion_profile),
});

export function insertVisit(db: DB, v: VisitRecord & { userId: string }) {
  db.prepare(
    `INSERT INTO visits (id,user_id,exhibition_id,exhibition_title,venue,date,duration_min,viewed_artwork_ids,
       recommended_count,reactions,longest_viewed_artwork_id,keywords,interpretation,emotion_profile)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    v.id, v.userId, v.exhibitionId, v.exhibitionTitle, v.venue, v.date, v.durationMin, j(v.viewedArtworkIds),
    v.recommendedCount, j(v.reactions), v.longestViewedArtworkId, j(v.keywords),
    v.interpretation ?? null, v.emotionProfile ? j(v.emotionProfile) : null,
  );
}

export function listVisits(db: DB, userId: string): VisitRecord[] {
  return (db.prepare('SELECT * FROM visits WHERE user_id = ? ORDER BY date DESC').all(userId) as Row[]).map(toVisit);
}

export function getVisit(db: DB, id: string): VisitRecord | null {
  const r = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as Row | undefined;
  return r ? toVisit(r) : null;
}
