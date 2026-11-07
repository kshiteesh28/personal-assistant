import { BaseRepository } from './base.repository';
import { logger } from '../config/logger';

export class IntegrationCacheRepository extends BaseRepository<any> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'integration_cache');
  }

  get(source: string, cacheKey: string): any | null {
    const row = this.db.query<{payload: string, expires_at: number}, any>(`
      SELECT payload, expires_at FROM integration_cache WHERE source = $source AND cache_key = $key
    `).get({ $source: source, $key: cacheKey });

    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.query(`DELETE FROM integration_cache WHERE source = $source AND cache_key = $key`).run({ $source: source, $key: cacheKey });
      return null;
    }
    return JSON.parse(row.payload);
  }

  set(source: string, cacheKey: string, payload: any, ttlMs: number): void {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const str = JSON.stringify(payload);
    this.db.query(`
      INSERT INTO integration_cache (source, cache_key, payload, fetched_at, expires_at)
      VALUES ($source, $key, $payload, $now, $expires)
      ON CONFLICT(source, cache_key) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `).run({
      $source: source,
      $key: cacheKey,
      $payload: str,
      $now: now,
      $expires: expiresAt
    });
  }

  purgeExpired(): void {
    const info = this.db.query(`DELETE FROM integration_cache WHERE expires_at <= $now`).run({ $now: Date.now() });
    if (info.changes > 0) {
      logger.info(`Purged ${info.changes} expired integration cache entries`);
    }
  }
}
