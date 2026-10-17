/**
 * 작품 이미지 자리표시자.
 * imageUrl이 있으면 실제 이미지를, 없으면 palette 색상으로 추상 구성 이미지를 SVG로 그린다.
 * seed(작품 id)가 같으면 항상 같은 그림이 나오도록 간단한 의사 난수(mulberry32)를 쓴다.
 */
import { useMemo } from 'react';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Props {
  seed: string;
  palette: string[];
  imageUrl?: string;
  alt: string;
  className?: string;
  ratio?: number; // 가로/세로 비율
}

export function ArtImage({ seed, palette, imageUrl, alt, className, ratio = 4 / 3 }: Props) {
  const shapes = useMemo(() => {
    const rnd = mulberry32(hash(seed));
    const pick = () => palette[Math.floor(rnd() * palette.length)];
    return Array.from({ length: 26 }, (_, i) => {
      const kind = rnd() > 0.5 ? 'c' : 'r';
      const size = 10 + rnd() * 32;
      return { kind, x: rnd() * 120 - 10, y: rnd() * 100 - 10, size, fill: pick(), key: i };
    });
  }, [seed, palette]);

  if (imageUrl) {
    return <img className={className} src={imageUrl} alt={alt} style={{ aspectRatio: ratio, objectFit: 'cover' }} />;
  }

  const h = 100 / ratio;
  return (
    <svg
      className={className}
      viewBox={`0 0 100 ${h}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={alt}
      style={{ aspectRatio: ratio, display: 'block', width: '100%' }}
    >
      <rect width="100" height={h} fill={palette[0]} />
      {shapes.map((s) =>
        s.kind === 'c' ? (
          <circle key={s.key} cx={s.x} cy={(s.y * h) / 100} r={s.size / 2} fill={s.fill} />
        ) : (
          <rect key={s.key} x={s.x} y={(s.y * h) / 100} width={s.size} height={s.size * 0.8} fill={s.fill} />
        ),
      )}
    </svg>
  );
}
