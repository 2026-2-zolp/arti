import type {
  Artwork,
  ArtworkInput,
  DashboardSummary,
  Exhibition,
  ExhibitionInput,
  Member,
  MemberDetail,
  ReviewStatus,
} from '@/types/domain';
import { commit, getDb } from '../db';
import { fail, ok, type MockRequest, type MockRoute } from '../http';

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: '검수 대기',
  source_check: '출처 확인',
  approved: '검수 완료',
};

const EXHIBITION_STATUS_LABEL: Record<Exhibition['status'], string> = {
  scheduled: '운영 예정',
  active: '운영 중',
  closed: '종료',
};

function currentAdmin(req: MockRequest) {
  if (!req.token?.startsWith('mock-admin-token:')) return null;
  const adminId = req.token.split(':')[1];
  return getDb().admins.find((a) => a.adminId === adminId) ?? null;
}

/** 관리자 인증이 필요한 핸들러 래퍼 */
function guard(handler: (req: MockRequest) => ReturnType<MockRoute[2]>) {
  return (req: MockRequest) => {
    if (!req.token) return fail(401, 'UNAUTHORIZED', '관리자 로그인이 필요해요.');
    if (!currentAdmin(req)) return fail(403, 'FORBIDDEN', '관리자 권한이 없어요.');
    return handler(req);
  };
}

function withCount(exhibition: Exhibition): Exhibition {
  return {
    ...exhibition,
    artworkCount: getDb().artworks.filter((a) => a.exhibitionId === exhibition.exhibitionId).length,
  };
}

function validateExhibition(input: Partial<ExhibitionInput>) {
  if (!input.title?.trim()) return '전시명을 입력해 주세요.';
  if (!input.startDate || !input.endDate) return '전시 기간을 입력해 주세요.';
  if (input.startDate > input.endDate) return '종료일은 시작일 이후여야 해요.';
  return null;
}

function validateArtwork(input: Partial<ArtworkInput>) {
  if (!input.title?.trim()) return '작품명을 입력해 주세요.';
  if (!input.artist?.trim()) return '작가를 입력해 주세요.';
  if (!input.exhibitionId) return '전시를 선택해 주세요.';
  return null;
}

function toMember(userId: string): Member | null {
  const db = getDb();
  const user = db.users.find((u) => u.userId === userId);
  if (!user) return null;
  const visits = db.visits
    .filter((v) => v.userId === userId)
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  return {
    userId: user.userId,
    memberCode: user.memberCode,
    email: user.email,
    nickname: user.nickname,
    joinedAt: user.joinedAt,
    visitCount: visits.length,
    lastVisitAt: visits[0]?.visitedAt ?? null,
    status: user.status,
  };
}

export const adminRoutes: MockRoute[] = [
  [
    'POST',
    '/admin/auth/login',
    ({ body }) => {
      const loginId = String(body.loginId ?? '').trim();
      const password = String(body.password ?? '');
      if (!loginId || !password)
        return fail(422, 'INVALID_INPUT', '관리자 ID와 비밀번호를 입력해 주세요.');
      const admin = getDb().admins.find((a) => a.loginId === loginId);
      if (!admin || admin.password !== password) {
        return fail(401, 'INVALID_CREDENTIALS', '관리자 ID 또는 비밀번호가 올바르지 않아요.');
      }
      return ok({
        token: `mock-admin-token:${admin.adminId}`,
        admin: { adminId: admin.adminId, name: admin.name },
      });
    },
  ],
  [
    'GET',
    '/admin/auth/me',
    guard((req) => {
      const admin = currentAdmin(req)!;
      return ok({ adminId: admin.adminId, name: admin.name });
    }),
  ],

  // ---- 대시보드 ----
  [
    'GET',
    '/admin/dashboard',
    guard(() => {
      const db = getDb();
      const positioned = new Set(db.positions.map((p) => p.artworkId));
      const recentArtworks = [...db.artworks]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 3)
        .map((a) => ({
          id: a.artworkId,
          category: '작품' as const,
          name: a.title,
          status: REVIEW_LABEL[a.reviewStatus],
          updatedAt: a.updatedAt,
          manager: '관리자',
        }));
      const recentExhibitions = [...db.exhibitions]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 2)
        .map((e) => ({
          id: e.exhibitionId,
          category: '전시' as const,
          name: e.title,
          status: EXHIBITION_STATUS_LABEL[e.status],
          updatedAt: e.updatedAt,
          manager: '관리자',
        }));
      const summary: DashboardSummary = {
        activeExhibitionCount: db.exhibitions.filter((e) => e.status === 'active').length,
        artworkCount: db.artworks.length,
        approvedArtworkCount: db.artworks.filter((a) => a.reviewStatus === 'approved').length,
        positionedArtworkCount: db.artworks.filter((a) => positioned.has(a.artworkId)).length,
        unpositionedArtworkCount: db.artworks.filter((a) => !positioned.has(a.artworkId)).length,
        pendingReviewCount: db.artworks.filter((a) => a.reviewStatus !== 'approved').length,
        recent: [...recentArtworks, ...recentExhibitions].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      };
      return ok(summary);
    }),
  ],

  // ---- 전시 ----
  ['GET', '/admin/exhibitions', guard(() => ok(getDb().exhibitions.map(withCount)))],
  [
    'POST',
    '/admin/exhibitions',
    guard(({ body }) => {
      const input = body as Partial<ExhibitionInput>;
      const error = validateExhibition(input);
      if (error) return fail(422, 'INVALID_INPUT', error);
      const exhibition: Exhibition = {
        exhibitionId: `ex-${Date.now()}`,
        title: input.title!.trim(),
        subtitle: input.subtitle ?? '',
        venue: input.venue ?? '',
        place: input.place ?? '',
        startDate: input.startDate!,
        endDate: input.endDate!,
        status: input.status ?? 'scheduled',
        artworkCount: 0,
        updatedAt: new Date().toISOString(),
      };
      const db = getDb();
      db.exhibitions.push(exhibition);
      commit();
      return ok(exhibition, 201);
    }),
  ],
  [
    'PUT',
    '/admin/exhibitions/:exhibitionId',
    guard(({ params, body }) => {
      const db = getDb();
      const target = db.exhibitions.find((e) => e.exhibitionId === params.exhibitionId);
      if (!target) return fail(404, 'EXHIBITION_NOT_FOUND', '전시 정보를 찾을 수 없어요.');
      const input = body as Partial<ExhibitionInput>;
      const error = validateExhibition({ ...target, ...input });
      if (error) return fail(422, 'INVALID_INPUT', error);
      Object.assign(target, input, { updatedAt: new Date().toISOString() });
      commit();
      return ok(withCount(target));
    }),
  ],

  // ---- 작품 ----
  [
    'GET',
    '/admin/artworks',
    guard(({ query }) => {
      const db = getDb();
      const list = query.exhibitionId
        ? db.artworks.filter((a) => a.exhibitionId === query.exhibitionId)
        : db.artworks;
      return ok(list);
    }),
  ],
  [
    'GET',
    '/admin/artworks/:artworkId',
    guard(({ params }) => {
      const artwork = getDb().artworks.find((a) => a.artworkId === params.artworkId);
      return artwork ? ok(artwork) : fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
    }),
  ],
  [
    'POST',
    '/admin/artworks',
    guard(({ body }) => {
      const input = body as Partial<ArtworkInput>;
      const error = validateArtwork(input);
      if (error) return fail(422, 'INVALID_INPUT', error);
      const db = getDb();
      const map = db.maps.find((m) => m.exhibitionId === input.exhibitionId);
      const artwork: Artwork = {
        artworkId: `aw-${Date.now()}`,
        exhibitionId: input.exhibitionId!,
        title: input.title!.trim(),
        artist: input.artist!.trim(),
        year: input.year ?? '',
        imageUrl: input.imageUrl ?? '',
        floorId: input.floorId || map?.floorId || '',
        roomName: input.roomName ?? '',
        description: input.description ?? '',
        guidedLooking: input.guidedLooking ?? [],
        source: input.source ?? '',
        referenceUrl: input.referenceUrl ?? '',
        reviewStatus: input.reviewStatus ?? 'pending',
        tasteTags: input.tasteTags ?? [],
        updatedAt: new Date().toISOString(),
      };
      db.artworks.push(artwork);
      commit();
      return ok(artwork, 201);
    }),
  ],
  [
    'PUT',
    '/admin/artworks/:artworkId',
    guard(({ params, body }) => {
      const db = getDb();
      const target = db.artworks.find((a) => a.artworkId === params.artworkId);
      if (!target) return fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
      const input = body as Partial<ArtworkInput>;
      const error = validateArtwork({ ...target, ...input });
      if (error) return fail(422, 'INVALID_INPUT', error);
      Object.assign(target, input, { updatedAt: new Date().toISOString() });
      commit();
      return ok(target);
    }),
  ],

  // ---- 지도 ----
  [
    'GET',
    '/admin/exhibitions/:exhibitionId/map',
    guard(({ params }) => {
      const db = getDb();
      const maps = db.maps.filter((m) => m.exhibitionId === params.exhibitionId);
      const mapIds = maps.map((m) => m.mapId);
      return ok({ maps, positions: db.positions.filter((p) => mapIds.includes(p.mapId)) });
    }),
  ],
  [
    'PUT',
    '/admin/maps/:mapId/positions/:artworkId',
    guard(({ params, body }) => {
      const db = getDb();
      const map = db.maps.find((m) => m.mapId === params.mapId);
      if (!map) return fail(404, 'MAP_NOT_FOUND', '평면도를 찾을 수 없어요.');
      const artwork = db.artworks.find((a) => a.artworkId === params.artworkId);
      if (!artwork) return fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
      const xRatio = Number(body.xRatio);
      const yRatio = Number(body.yRatio);
      if (![xRatio, yRatio].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
        return fail(422, 'INVALID_POSITION', '좌표는 0~1 범위여야 해요.');
      }
      const position = {
        artworkId: artwork.artworkId,
        mapId: map.mapId,
        floorId: map.floorId,
        xRatio: Math.round(xRatio * 10000) / 10000,
        yRatio: Math.round(yRatio * 10000) / 10000,
      };
      db.positions = db.positions.filter((p) => p.artworkId !== artwork.artworkId);
      db.positions.push(position);
      // 위치가 속한 전시실 이름도 함께 갱신
      const room = map.rooms.find(
        (r) =>
          position.xRatio >= r.xRatio &&
          position.xRatio <= r.xRatio + r.widthRatio &&
          position.yRatio >= r.yRatio &&
          position.yRatio <= r.yRatio + r.heightRatio,
      );
      artwork.floorId = map.floorId;
      if (room) artwork.roomName = room.name;
      artwork.updatedAt = new Date().toISOString();
      commit();
      return ok(position);
    }),
  ],

  // ---- 회원 ----
  [
    'GET',
    '/admin/members',
    guard(({ query }) => {
      const keyword = (query.keyword ?? '').trim().toLowerCase();
      const members = getDb()
        .users.filter(
          (u) =>
            !keyword ||
            u.email.toLowerCase().includes(keyword) ||
            u.nickname.toLowerCase().includes(keyword) ||
            u.memberCode.toLowerCase().includes(keyword),
        )
        .map((u) => toMember(u.userId)!)
        .sort((a, b) => a.memberCode.localeCompare(b.memberCode));
      return ok(members);
    }),
  ],
  [
    'GET',
    '/admin/members/:userId',
    guard(({ params }) => {
      const member = toMember(params.userId);
      if (!member) return fail(404, 'MEMBER_NOT_FOUND', '회원 정보를 찾을 수 없어요.');
      const detail: MemberDetail = {
        ...member,
        visits: getDb()
          .visits.filter((v) => v.userId === params.userId)
          .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
          .map((v) => ({
            visitId: v.visitId,
            exhibitionTitle: v.exhibitionTitle,
            visitedAt: v.visitedAt,
            viewedCount: v.viewedCount,
            durationMinutes: v.durationMinutes,
          })),
      };
      return ok(detail);
    }),
  ],
];
