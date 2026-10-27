/**
 * 관리자 API (A-01 ~ A-06). 로그인을 제외한 모든 요청에 X-Admin-Token 필요.
 */
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { config } from '../config.js';
import { z } from 'zod';
import type { DB } from '../db.js';
import { createSession, deleteSession, HttpError, parse, rateLimit, requireAdmin } from '../http.js';
import { summarizeDescription } from '../lib/ai.js';
import { analyzeEmotions } from '../lib/emotionClient.js';
import { hashPassword, newId, newToken, verifyPassword } from '../lib/password.js';
import { confirmTagScores, suggestedTags } from '../lib/tags.js';
import type { Artwork } from '../types.js';
import * as repo from '../repo.js';
import { artworkInput, exhibitionInput } from '../schemas.js';

const DUMMY_HASH = hashPassword('dummy-password-0');

export function adminRoutes(db: DB) {
  const r = Router();

  /** A-01 관리자 로그인 */
  r.post('/admin/login', rateLimit(10, 60_000), (req, res) => {
    const body = parse(z.object({ id: z.string().trim().max(64), password: z.string().max(128) }), req.body);
    const admin = db.prepare('SELECT id, password_hash, name FROM admins WHERE login_id = ?').get(body.id) as
      | { id: string; password_hash: string; name: string }
      | undefined;
    const ok = verifyPassword(body.password, admin?.password_hash ?? DUMMY_HASH);
    if (!admin || !ok) throw new HttpError(401, '관리자 ID 또는 비밀번호가 올바르지 않아요.');
    const token = newToken();
    createSession(db, 'admin', admin.id, token);
    res.json({ name: admin.name, token });
  });

  r.post('/admin/logout', (req, res) => {
    deleteSession(db, req.get('x-admin-token') ?? undefined);
    res.status(204).end();
  });

  r.use('/admin', requireAdmin);

  /** A-03 전시 등록·수정 (id가 비어 있으면 새로 등록) */
  r.post('/admin/exhibitions', (req, res) => {
    res.status(201).json(repo.upsertExhibition(db, { ...parse(exhibitionInput, req.body), id: '', floorPlan: null }));
  });

  // 평면도 이미지는 전용 API(/floor-plan)로만 바꾼다
  r.put('/admin/exhibitions/:id', (req, res) => {
    const prev = repo.getExhibition(db, req.params.id);
    if (!prev) throw new HttpError(404, '전시 정보를 찾을 수 없어요.');
    res.json(repo.upsertExhibition(db, { ...parse(exhibitionInput, req.body), id: prev.id, floorPlan: prev.floorPlan }));
  });

  /** A-04 작품 등록·수정, A-05 위치 지정도 이 API로 저장 */
  const checkExhibition = (id: string) => {
    if (!repo.getExhibition(db, id)) throw new HttpError(400, '존재하지 않는 전시예요.');
  };

  /** AI 태그를 확정한 작품은 AI 제안과 관리자가 켠 태그로 확정 점수를 계산 (보낸 tagScores는 쓰지 않음) */
  const withTagScores = (w: Artwork): Artwork => ({
    ...w,
    tagScores: w.tagStatus === 'confirmed' && w.analysis?.tags ? confirmTagScores(w.analysis.tags, w.tags) : null,
  });

  r.post('/admin/artworks', (req, res) => {
    const body = parse(artworkInput, req.body);
    checkExhibition(body.exhibitionId);
    res.status(201).json(repo.upsertArtwork(db, withTagScores({ ...body, id: '', updatedAt: '' })));
  });

  r.put('/admin/artworks/:id', (req, res) => {
    const prev = repo.getArtwork(db, req.params.id);
    if (!prev) throw new HttpError(404, '작품 정보를 찾을 수 없어요.');
    const body = parse(artworkInput, req.body);
    checkExhibition(body.exhibitionId);
    // 공식 해설이나 이미지가 바뀌면, 그 내용으로 만든 AI 결과는 다시 확인이 필요하다 → 확정 해제
    const sourceChanged = prev.description !== body.description || (prev.imageUrl ?? '') !== (body.imageUrl ?? '');
    const demote = (s: typeof body.emotionStatus) => (sourceChanged && s === 'confirmed' ? 'suggested' : s);
    res.json(
      repo.upsertArtwork(
        db,
        withTagScores({
          ...body,
          id: req.params.id,
          imageFile: prev.imageFile,
          updatedAt: '',
          emotionStatus: demote(body.emotionStatus),
          summaryStatus: demote(body.summaryStatus),
          tagStatus: demote(body.tagStatus),
        }),
      ),
    );
  });

  /**
   * AI 분석: 취향 태그·감정 분석(ai-service) + 해설 요약(Claude)을 동시에 실행하고 「AI 제안」 상태로 저장.
   * 관리자가 A-04에서 확인·수정한 뒤 확정(tagStatus/emotionStatus/summaryStatus = 'confirmed')해야 추천·사용자 화면에 쓰인다.
   * 확정 전 추천에는 관리자가 켠 태그만 쓰인다.
   * 감정 분석 서버가 꺼져 있어도 요약은 저장하고, 실패 이유를 함께 돌려준다.
   */
  async function runAnalysis(w: Artwork, useImage: boolean) {
    const [emo, sum] = await Promise.allSettled([analyzeEmotions(w, useImage), summarizeDescription(w)]);
    const next: Artwork = { ...w };
    if (emo.status === 'fulfilled') {
      next.analysis = emo.value;
      next.emotionStatus = 'suggested';
      if (emo.value.tags) {
        next.tagStatus = 'suggested';
        next.tagScores = null;
      }
    }
    if (sum.status === 'fulfilled' && sum.value.summary) {
      next.summary = sum.value.summary;
      next.summaryKeywords = sum.value.keywords;
      next.summaryStatus = 'suggested';
    }
    const saved = repo.upsertArtwork(db, next);
    return {
      artwork: saved,
      emotion: emo.status === 'fulfilled' ? { ok: true as const } : { ok: false as const, error: (emo.reason as Error).message },
      summary: sum.status === 'fulfilled' ? { ok: true as const, source: sum.value.source } : { ok: false as const, error: '요약에 실패했어요.' },
    };
  }

  r.post('/admin/artworks/:id/analyze', async (req, res) => {
    const w = repo.getArtwork(db, String(req.params.id));
    if (!w) throw new HttpError(404, '작품 정보를 찾을 수 없어요.');
    const { useImage } = parse(z.object({ useImage: z.boolean().default(true) }), req.body ?? {});
    res.json(await runAnalysis(w, useImage));
  });

  /** 전시의 작품 전체를 차례로 분석 (확정된 작품은 건너뜀). 모델이 CPU에서 돌아서 작품 수만큼 시간이 걸린다. */
  r.post('/admin/exhibitions/:id/analyze', async (req, res) => {
    const exId = String(req.params.id);
    if (!repo.getExhibition(db, exId)) throw new HttpError(404, '전시 정보를 찾을 수 없어요.');
    const { useImage } = parse(z.object({ useImage: z.boolean().default(true) }), req.body ?? {});
    const targets = repo
      .listArtworks(db, exId)
      .filter((w) => w.tagStatus !== 'confirmed' || w.emotionStatus !== 'confirmed' || w.summaryStatus !== 'confirmed');
    let analyzed = 0;
    const errors: string[] = [];
    for (const w of targets) {
      const out = await runAnalysis(w, useImage);
      if (out.emotion.ok) analyzed += 1;
      else {
        errors.push(`${w.title}: ${out.emotion.error}`);
        // 서버 연결 자체가 안 되면 나머지도 실패하므로 중단
        if (out.emotion.error.includes('연결할 수 없어요')) break;
      }
    }
    res.json({ total: targets.length, analyzed, errors });
  });

  /** 전시의 「AI 제안」을 한 번에 확정 (관리자가 결과를 훑어본 뒤 사용). 태그는 AI가 "해당함"으로 본 태그를 그대로 켠다 */
  r.post('/admin/exhibitions/:id/confirm-ai', (req, res) => {
    const exId = String(req.params.id);
    if (!repo.getExhibition(db, exId)) throw new HttpError(404, '전시 정보를 찾을 수 없어요.');
    let confirmed = 0;
    for (const w of repo.listArtworks(db, exId)) {
      const emo = w.emotionStatus === 'suggested';
      const sum = w.summaryStatus === 'suggested';
      const tag = w.tagStatus === 'suggested' && !!w.analysis?.tags;
      if (!emo && !sum && !tag) continue;
      repo.upsertArtwork(
        db,
        withTagScores({
          ...w,
          emotionStatus: emo ? 'confirmed' : w.emotionStatus,
          summaryStatus: sum ? 'confirmed' : w.summaryStatus,
          tagStatus: tag ? 'confirmed' : w.tagStatus,
          tags: tag ? suggestedTags(w.analysis!.tags!) : w.tags,
        }),
      );
      confirmed += 1;
    }
    res.json({ confirmed });
  });

  /**
   * 작품 이미지 파일 업로드 (캡처한 이미지 등). 요청 본문 = 이미지 파일 그대로, Content-Type = image/png|jpeg|webp
   * 파일 앞부분(시그니처)으로 실제 이미지인지 확인한다. 이미지가 바뀌면 확정된 AI 결과는 「AI 제안」으로 돌아간다.
   */
  const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
    'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  };
  const removeFile = (file: string | null) => {
    if (file) fs.rmSync(path.join(config.uploadDir, path.basename(file)), { force: true });
  };
  const demoteAi = (w: Artwork): Artwork => ({
    ...w,
    emotionStatus: w.emotionStatus === 'confirmed' ? 'suggested' : w.emotionStatus,
    summaryStatus: w.summaryStatus === 'confirmed' ? 'suggested' : w.summaryStatus,
    tagStatus: w.tagStatus === 'confirmed' ? 'suggested' : w.tagStatus,
    tagScores: null,
  });

  /** 요청 본문의 이미지를 검사해 업로드 폴더에 저장하고 파일 이름을 돌려준다 */
  const saveUpload = (req: express.Request, prefix: string) => {
    const type = IMAGE_TYPES[(req.get('content-type') ?? '').split(';')[0].trim()];
    const body = req.body as unknown;
    if (!type || !Buffer.isBuffer(body) || body.length === 0)
      throw new HttpError(415, 'PNG, JPG, WEBP 이미지 파일만 올릴 수 있어요.');
    if (!type.magic(body)) throw new HttpError(415, '이미지 파일이 아니거나 손상된 파일이에요.');
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const file = `${prefix}-${newId('img').slice(4)}.${type.ext}`;
    fs.writeFileSync(path.join(config.uploadDir, file), body);
    return file;
  };
  const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: '10mb' });

  r.post('/admin/artworks/:id/image', rawImage, (req, res) => {
    const w = repo.getArtwork(db, String(req.params.id));
    if (!w) throw new HttpError(404, '작품 정보를 찾을 수 없어요.');
    const file = saveUpload(req, w.id);
    removeFile(w.imageFile);
    res.json(repo.upsertArtwork(db, { ...demoteAi(w), imageFile: file }));
  });

  r.delete('/admin/artworks/:id/image', (req, res) => {
    const w = repo.getArtwork(db, String(req.params.id));
    if (!w) throw new HttpError(404, '작품 정보를 찾을 수 없어요.');
    if (!w.imageFile) return void res.json(w);
    removeFile(w.imageFile);
    res.json(repo.upsertArtwork(db, { ...demoteAi(w), imageFile: null }));
  });

  /**
   * A-05 미술관 평면도(안내도) 이미지 업로드. 본문 = 이미지 파일, ?width=&height= = 원본 픽셀 크기(화면 비율용)
   * 작품 위치는 이미지 기준 퍼센트 좌표라 비율이 다른 이미지로 바꾸면 위치를 다시 확인해야 한다.
   */
  r.post('/admin/exhibitions/:id/floor-plan', rawImage, (req, res) => {
    const ex = repo.getExhibition(db, String(req.params.id));
    if (!ex) throw new HttpError(404, '전시 정보를 찾을 수 없어요.');
    const size = z.coerce.number().int().min(1).max(20_000);
    const { width, height } = parse(z.object({ width: size, height: size }), req.query);
    const file = saveUpload(req, `${ex.id}-plan`);
    removeFile(ex.floorPlan?.file ?? null);
    res.json(repo.upsertExhibition(db, { ...ex, floorPlan: { file, width, height } }));
  });

  r.delete('/admin/exhibitions/:id/floor-plan', (req, res) => {
    const ex = repo.getExhibition(db, String(req.params.id));
    if (!ex) throw new HttpError(404, '전시 정보를 찾을 수 없어요.');
    removeFile(ex.floorPlan?.file ?? null);
    res.json(repo.upsertExhibition(db, { ...ex, floorPlan: null }));
  });

  /** A-06 회원 조회 (이메일·닉네임 검색) */
  r.get('/admin/members', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    res.json(repo.listMembers(db, q));
  });

  return r;
}
