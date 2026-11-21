/**
 * 작품 크게 보기 화면에서 그림을 확대·축소·이동하는 영역.
 * - 두 손가락 벌리기/오므리기: 손가락 사이를 중심으로 확대·축소 (최대 MAX_SCALE배)
 * - 확대한 상태에서 끌기: 그림 이동
 * - 두 번 탭: 그 지점 DOUBLE_TAP_SCALE배 확대 ↔ 원래 크기
 * - PC 마우스 휠: 확대·축소
 * 움직이는 동안에는 매 프레임 손가락을 그대로 따라가고(transform만 바꿈),
 * 손을 뗀 뒤 1배보다 작거나 그림 가장자리가 화면 안쪽으로 들어오면 짧게 부드럽게 되돌린다.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SETTLE_MS = 200;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10; // 이만큼 움직이면 탭이 아니라 끌기로 본다(px)

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };

export function ZoomableImage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: View; pinchDist: number; mid: Point; pan: Point } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const frame = useRef(0);
  // 마지막 두 손가락 가운데 지점. 최대 배율을 넘겨 벌렸다가 손을 떼면 이 지점을 기준으로 되돌린다.
  const pinchMid = useRef<Point | null>(null);

  /** 화면에 transform을 반영한다. 연속 이동은 다음 화면 갱신 때 한 번만 그린다. */
  function apply(animate: boolean) {
    const el = contentRef.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const { scale, x, y } = view.current;
      el.style.transition = animate ? `transform ${SETTLE_MS}ms ease-out` : 'none';
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    });
  }

  /** 1배 화면에서 실제 그림이 차지하는 영역(작품 전체 표시로 생긴 여백 제외). */
  function imageBox() {
    const stage = stageRef.current!;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const img = contentRef.current?.querySelector('img');
    if (!img || !img.naturalWidth || !img.naturalHeight) return { W, H, left: 0, top: 0, w: W, h: H };
    const fit = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * fit;
    const h = img.naturalHeight * fit;
    return { W, H, left: (W - w) / 2, top: (H - h) / 2, w, h };
  }

  /** 배율을 1~MAX_SCALE로 맞추고, 그림이 화면 밖으로 밀려나지 않게 위치를 맞춘다. */
  function clamped(v: View): View {
    const { W, H, left, top, w, h } = imageBox();
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale));
    const fitAxis = (pos: number, size: number, offset: number, frameSize: number) => {
      const shown = size * scale;
      if (shown <= frameSize) return (frameSize - shown) / 2 - offset * scale; // 화면보다 작으면 가운데
      const min = frameSize - (offset + size) * scale; // 그림 오른쪽(아래) 끝이 화면 끝에 닿는 위치
      const max = -offset * scale; // 그림 왼쪽(위) 끝이 화면 끝에 닿는 위치
      return Math.min(max, Math.max(min, pos));
    };
    return { scale, x: fitAxis(v.x, w, left, W), y: fitAxis(v.y, h, top, H) };
  }

  /** 화면의 한 점(px)을 기준으로 배율을 바꾼다. */
  function zoomAt(point: Point, nextScale: number, from: View = view.current): View {
    const contentX = (point.x - from.x) / from.scale;
    const contentY = (point.y - from.y) / from.scale;
    return { scale: nextScale, x: point.x - contentX * nextScale, y: point.y - contentY * nextScale };
  }

  /** 최대 배율을 넘었으면 손가락 사이 지점을 그대로 두고 최대 배율로 줄인다(배율만 줄이면 보던 곳이 옆으로 밀려났다). */
  function backToMaxScale() {
    if (view.current.scale > MAX_SCALE && pinchMid.current) view.current = zoomAt(pinchMid.current, MAX_SCALE);
  }

  function settle() {
    backToMaxScale();
    view.current = clamped(view.current);
    apply(true);
  }

  function localPoint(e: { clientX: number; clientY: number }): Point {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startGesture() {
    const pts = [...pointers.current.values()];
    const start = { ...view.current };
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { start, pinchDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pan: a };
    } else if (pts.length === 1) {
      gesture.current = { start, pinchDist: 0, mid: pts[0], pan: pts[0] };
    } else {
      gesture.current = null;
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // 손가락이 영역 밖으로 나가도 이어서 받는다
    } catch {
      // 일부 환경에서 잡을 수 없는 포인터는 그대로 진행한다.
    }
    pointers.current.set(e.pointerId, localPoint(e));
    if (pointers.current.size === 1) moved.current = false;
    startGesture();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, localPoint(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // 손가락을 따라가되, 범위 밖에서는 조금만 더 커지거나 작아지게 해 손을 떼면 되돌아갈 여지를 남긴다.
      const raw = g.start.scale * (dist / g.pinchDist);
      const scale = raw > MAX_SCALE ? MAX_SCALE + (raw - MAX_SCALE) * 0.3 : raw < 1 ? 1 - (1 - raw) * 0.5 : raw;
      const zoomed = zoomAt(g.mid, scale, g.start);
      view.current = { scale, x: zoomed.x + (mid.x - g.mid.x), y: zoomed.y + (mid.y - g.mid.y) };
      pinchMid.current = mid;
      moved.current = true;
    } else {
      const p = pts[0];
      const dx = p.x - g.pan.x;
      const dy = p.y - g.pan.y;
      if (Math.hypot(dx, dy) > TAP_SLOP) moved.current = true;
      if (g.start.scale <= 1) return; // 원래 크기에서는 끌어도 움직이지 않는다
      const target = { scale: g.start.scale, x: g.start.x + dx, y: g.start.y + dy };
      const limit = clamped(target);
      // 가장자리 밖으로는 손가락보다 덜 따라가게 해서 끝에 닿았다는 느낌을 준다.
      view.current = { scale: target.scale, x: limit.x + (target.x - limit.x) * 0.3, y: limit.y + (target.y - limit.y) * 0.3 };
    }
    apply(false);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const point = localPoint(e);
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      backToMaxScale(); // 최대 배율을 넘긴 채로 끌지 않게 먼저 되돌린다
      apply(true);
      startGesture(); // 두 손가락 중 하나를 떼면 남은 손가락으로 이어서 끌기
      return;
    }
    gesture.current = null;
    if (wasSingle && !moved.current && e.type === 'pointerup') {
      const now = performance.now();
      const prev = lastTap.current;
      if (prev && now - prev.time < DOUBLE_TAP_MS && Math.hypot(point.x - prev.x, point.y - prev.y) < TAP_SLOP * 3) {
        lastTap.current = null;
        view.current = view.current.scale > 1.05
          ? { scale: 1, x: 0, y: 0 }
          : zoomAt(point, DOUBLE_TAP_SCALE);
        settle();
        return;
      }
      lastTap.current = { time: now, ...point };
    }
    settle();
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let wheelTimer = 0;
    // React의 onWheel은 passive라 기본 동작(페이지 확대·스크롤)을 막을 수 없어서 직접 등록한다.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const point = localPoint(e);
      const next = Math.min(MAX_SCALE, Math.max(1, view.current.scale * Math.exp(-e.deltaY * 0.0015)));
      view.current = zoomAt(point, next);
      apply(false);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(settle, 120);
    };
    // 화면 크기가 바뀌면(회전 등) 위치를 다시 맞춘다.
    const onResize = () => settle();
    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(wheelTimer);
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={stageRef}
      className="zoom-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={contentRef} className="zoom-content">
        {children}
      </div>
    </div>
  );
}
