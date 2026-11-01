/**
 * 캡처 40점 테스트 전시 만들기 — 실행: npm run seed:captures
 *
 * ai-service/evaluation/tag_eval_set.json 의 40점과 캡처 그림(ai-service/evaluation/images/01.jpg ~ 40.jpg)으로
 * 「캡처 40점 테스트 전시」(ex-capture)를 만든다. 작품은 검수 완료 + 평면도 위치까지 넣어 바로 추천을 시험할 수 있다.
 * 태그는 비워 두므로 관리자 「작품 관리」에서 전시를 고르고 「전시 AI 일괄 분석」 → 「AI 제안 모두 확정」을 하면 된다.
 * 해설은 scripts/capture-descriptions.json (Claude가 쓴 초안, 검수 전 — 출처 링크 확인 필요)
 * 이미 있는 작품은 해설·출처만 바꾸고 AI 분석 결과는 유지한다. 해설이 바뀌면 감정·요약은 「확정 → 제안」으로 돌린다
 * (관리자 화면에서 해설을 고칠 때와 같은 규칙). 처음부터 다시 만들려면 --reset
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';
import * as repo from '../src/repo.js';
import type { Artwork, Exhibition } from '../src/types.js';

const EX_ID = 'ex-capture';
const EVAL_DIR = path.resolve('../ai-service/evaluation');
const reset = process.argv.includes('--reset');

const desc = JSON.parse(fs.readFileSync(path.resolve('scripts/capture-descriptions.json'), 'utf-8')) as {
  checkedAt: string | null;
  items: Record<string, { text: string; url: string }>;
};
// 출처 칸에 해설의 성격(공식 해설이 아님)과 검수 상태, 위치가 시연용이라는 점을 함께 적는다 (data/README.md 검수 기준)
const sourceNote = `해설: Claude(AI) 작성 초안 · ${desc.checkedAt ? `출처 확인 ${desc.checkedAt}` : '검수 전, 출처 링크 확인 필요'} · 그림: 검증용 캡처(팀 내부 실험) · 위치: 시연용(mock)`;

const items = (JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'tag_eval_set.json'), 'utf-8')) as {
  items: { id: string; title: string; artist: string; year?: string }[];
}).items;

const db = openDb(config.dbPath);

const exhibition: Exhibition = {
  id: EX_ID,
  title: '캡처 40점 테스트 전시',
  subtitle: 'AI 취향 태그 시험용 (팀 내부 실험)',
  venue: 'ARTI 시범 전시관',
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  status: 'running',
  entrance: { x: 56, y: 99 },
  floorPlan: repo.getExhibition(db, EX_ID)?.floorPlan ?? null,
  rooms: [
    { id: 'r1', name: '1전시실', rect: { x: 3, y: 3, w: 45, h: 43 } },
    { id: 'r2', name: '2전시실', rect: { x: 52, y: 3, w: 45, h: 43 } },
    { id: 'r3', name: '3전시실', rect: { x: 3, y: 53, w: 45, h: 43 } },
    { id: 'r4', name: '4전시실', rect: { x: 52, y: 53, w: 45, h: 43 } },
  ],
};
repo.upsertExhibition(db, exhibition);

fs.mkdirSync(config.uploadDir, { recursive: true });
let added = 0;
let updated = 0;
let skipped = 0;
const missing: string[] = [];
items.forEach((it, i) => {
  const id = `cap-${it.id}`;
  const text = desc.items[it.id]?.text ?? '';
  const referenceUrl = desc.items[it.id]?.url ?? '';
  const prev = repo.getArtwork(db, id);
  if (!reset && prev) {
    if (prev.description === text && prev.source === sourceNote && prev.referenceUrl === referenceUrl) return void (skipped += 1);
    const demote = (s: Artwork['emotionStatus']) => (prev.description !== text && s === 'confirmed' ? 'suggested' : s);
    repo.upsertArtwork(db, {
      ...prev,
      description: text,
      source: sourceNote,
      referenceUrl,
      emotionStatus: demote(prev.emotionStatus),
      summaryStatus: demote(prev.summaryStatus),
    });
    return void (updated += 1);
  }
  const src = ['.jpg', '.png', '.jpeg', '.webp'].map((ext) => path.join(EVAL_DIR, 'images', it.id + ext)).find((f) => fs.existsSync(f));
  if (!src) return void missing.push(it.id);
  const imageFile = `${id}${path.extname(src)}`;
  fs.copyFileSync(src, path.join(config.uploadDir, imageFile));

  // 같은 태그의 작품(5점씩 연속)이 한 전시실에 몰리지 않도록 번호 순서대로 전시실을 돌려 가며 배치
  const room = exhibition.rooms[i % 4];
  const slot = Math.floor(i / 4); // 전시실마다 0~9번 자리 (5칸 × 2줄)
  const position = {
    x: Math.round((room.rect!.x + 5 + (slot % 5) * ((room.rect!.w - 10) / 4)) * 10) / 10,
    y: Math.round((room.rect!.y + 12 + Math.floor(slot / 5) * 20) * 10) / 10,
  };
  const w: Artwork = {
    id,
    exhibitionId: EX_ID,
    title: it.title,
    artist: it.artist,
    year: it.year ?? '',
    roomId: room.id,
    position,
    palette: ['#EDE6DD', '#8C6A4A', '#2E3A4D', '#C99A55', '#F7F1E8'],
    imageFile,
    showImage: true,
    tags: [],
    tagScores: null,
    tagStatus: 'none',
    description: text,
    guidedLooking: [],
    guidedHints: [],
    guideIntro: '',
    guideStatus: 'none',
    source: sourceNote,
    referenceUrl,
    reviewStatus: 'approved',
    updatedAt: '',
    analysis: null,
    emotionStatus: 'none',
    summary: '',
    summaryKeywords: [],
    summaryStatus: 'none',
  };
  repo.upsertArtwork(db, w);
  added += 1;
});

console.log(`「${exhibition.title}」 준비 완료 — 새로 넣은 작품 ${added}점, 해설을 바꾼 작품 ${updated}점, 그대로 둔 작품 ${skipped}점`);
if (updated) console.log('해설이 바뀐 작품은 감정 분석·요약을 다시 해야 해요: 「전시 AI 일괄 분석」');
if (missing.length) console.log(`캡처 그림이 없는 번호: ${missing.join(', ')} (ai-service/evaluation/images/ 확인)`);
console.log('다음: 관리자 「작품 관리」에서 전시를 고르고 「전시 AI 일괄 분석」 → 「AI 제안 모두 확정」');
console.log(`사용자 화면: http://localhost:5173/exhibitions/${EX_ID}`);
db.close();
