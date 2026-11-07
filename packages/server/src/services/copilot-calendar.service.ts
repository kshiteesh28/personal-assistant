import { Event } from '@secretary/shared';
import { logger } from '../config/logger';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * CopilotCalendarService reads calendar events from M365 Copilot.
 * In the real deployment, the query-copilot.ps1 script writes events JSON
 * to .cache/copilot-llm-response.json. This service reads that file.
 * Falls back to empty array if the cache file is missing or stale.
 */
export class CopilotCalendarService {
  private cachePath: string;
  private CACHE_TTL_MS = 3600_000; // 1 hour

  constructor(projectRoot: string) {
    this.cachePath = join(projectRoot, '.cache', 'copilot-llm-response.json');
  }

  async getEvents(startMs: number, endMs: number): Promise<Event[]> {
    if (!existsSync(this.cachePath)) {
      logger.info('[CopilotCalendarService] No cache file found, returning empty');
      return [];
    }

    try {
      const raw = await Bun.file(this.cachePath).text();
      const data = JSON.parse(raw);

      // Cache freshness check
      if (data.generatedAt && Date.now() - data.generatedAt > this.CACHE_TTL_MS) {
        logger.info('[CopilotCalendarService] Cache stale, returning empty');
        return [];
      }

      const events: Event[] = (data.events ?? []).filter(
        (e: Event) => e.start_ts >= startMs && e.end_ts <= endMs,
      );

      logger.info(`[CopilotCalendarService] Returned ${events.length} events from cache`);
      return events;
    } catch (err) {
      logger.warn(`[CopilotCalendarService] Failed to parse cache: ${err}`);
      return [];
    }
  }

  async invalidateCache(): Promise<void> {
    // Used to force fresh data on next query
    try {
      if (existsSync(this.cachePath)) {
        const data = JSON.parse(await Bun.file(this.cachePath).text());
        data.generatedAt = 0;
        await Bun.write(this.cachePath, JSON.stringify(data));
      }
    } catch {
      // Ignore
    }
  }
}
