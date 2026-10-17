/**
 * 임시 작품 이미지 생성기.
 * 실제 작품 이미지 저작권/검증 전까지 시드값 기반 추상 SVG 를 data URI 로 만들어 imageUrl 로 사용한다.
 */
const PALETTES: Record<string, string[]> = {
  night: ['#1f3a7a', '#2c5aa0', '#e9d36b', '#16223f', '#6f93c9', '#f4e7a1'],
  mint: ['#d8ece4', '#82b5a3', '#f1dc9c', '#c88f6b', '#4b7062', '#e9c98b'],
  red: ['#f3d6cb', '#d9534a', '#f1b84a', '#8f2121', '#3e5266', '#e86f5a'],
  sand: ['#ebe5dc', '#8c6d4f', '#f7f1e8', '#c99a58', '#2f3a4f', '#a87b4f'],
  pop: ['#f2ead8', '#e8584f', '#2e3d5a', '#e1b030', '#ef8a3c', '#c74840'],
  sun: ['#f5e6b8', '#e7a531', '#7a5a24', '#cf6d2c', '#f3d061', '#5f7a3a'],
  dawn: ['#cfd8e0', '#e98a5b', '#5d7690', '#2f4258', '#f0b58e', '#9eb3c5'],
  grid: ['#f4f1ea', '#d63a2f', '#1f4aa8', '#f2c230', '#1b1b1b', '#ffffff'],
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createArtImage(seed: string, paletteName: keyof typeof PALETTES = 'mint') {
  const palette = PALETTES[paletteName];
  const rand = mulberry32(hash(seed));
  const pick = () => palette[1 + Math.floor(rand() * (palette.length - 1))];
  const shapes: string[] = [];

  if (paletteName === 'grid') {
    shapes.push(
      `<rect x="0" y="0" width="140" height="170" fill="${palette[2]}"/>`,
      `<rect x="150" y="0" width="250" height="170" fill="${palette[1]}"/>`,
      `<rect x="0" y="180" width="140" height="120" fill="${palette[5]}"/>`,
      `<rect x="150" y="180" width="200" height="120" fill="${palette[5]}"/>`,
      `<rect x="360" y="230" width="40" height="70" fill="${palette[3]}"/>`,
      `<g fill="${palette[4]}"><rect x="140" y="0" width="10" height="300"/><rect x="0" y="170" width="400" height="10"/><rect x="350" y="180" width="10" height="120"/><rect x="350" y="220" width="50" height="10"/></g>`,
    );
  } else {
    for (let i = 0; i < 26; i += 1) {
      const x = Math.round(rand() * 400);
      const y = Math.round(rand() * 300);
      const size = 30 + Math.round(rand() * 90);
      if (rand() > 0.5) {
        shapes.push(`<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${pick()}"/>`);
      } else {
        shapes.push(
          `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${Math.round(size * (0.6 + rand()))}" fill="${pick()}"/>`,
        );
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice"><rect width="400" height="300" fill="${palette[0]}"/>${shapes.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
