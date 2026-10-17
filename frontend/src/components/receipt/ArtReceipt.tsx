import { Chip } from '@/components/common';
import type { Reaction } from '@/types/domain';
import styles from './ArtReceipt.module.css';

export interface ArtReceiptData {
  viewedCount: number;
  recommendedCount: number;
  reactionCount: number;
  longestViewedTitle: string | null;
  tasteKeywords: string[];
  artworks?: { artworkId: string; title: string; reaction: Reaction | null }[];
}

/** U-12 아트 영수증 본문 — 현재 관람 / 과거 기록 조회 모드 공통 */
export function ArtReceipt({ data }: { data: ArtReceiptData }) {
  return (
    <article className={styles.receipt} aria-label="아트 영수증">
      <h3 className={styles.head}>ART RECEIPT</h3>
      <hr className={styles.rule} />
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>관람 작품</dt>
          <dd>{data.viewedCount}점</dd>
        </div>
        <div className={styles.row}>
          <dt>추천 작품</dt>
          <dd>{data.recommendedCount}점</dd>
        </div>
        <div className={styles.row}>
          <dt>선호 표시</dt>
          <dd>{data.reactionCount}회</dd>
        </div>
        <div className={styles.row}>
          <dt>가장 오래 본 작품</dt>
          <dd>{data.longestViewedTitle ?? '-'}</dd>
        </div>
      </dl>

      {data.artworks && data.artworks.length > 0 && (
        <>
          <hr className={styles.rule} />
          <ul className={styles.artworks}>
            {data.artworks.map((a) => (
              <li key={a.artworkId}>
                <span>{a.title}</span>
                <span className={styles.reaction}>
                  {a.reaction === 'like' ? '👍' : a.reaction === 'dislike' ? '👎' : '·'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <hr className={styles.rule} />
      <p className={styles.keywordLabel}>오늘의 취향 키워드</p>
      <div className={styles.keywords}>
        {data.tasteKeywords.length ? (
          data.tasteKeywords.slice(0, 4).map((k) => (
            <Chip key={k} tone="accent" size="sm">
              {k}
            </Chip>
          ))
        ) : (
          <span className={styles.none}>-</span>
        )}
      </div>
      <p className={styles.footer}>오늘 본 작품을 기억해두세요.</p>
    </article>
  );
}
