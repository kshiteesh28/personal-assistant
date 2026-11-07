import { EventBus } from '../event-bus';
import { getConfig } from '../../config';
import { logger } from '../../config/logger';

/**
 * DailyBriefTriggerJob — checks every 60 seconds if it's time to emit.
 * Emits `brief.ready` SSE event when the current time matches
 * the configured `dailyBriefTime` (HH:MM). Debounced to 5 minutes
 * to prevent duplicate emissions.
 */
export class DailyBriefTriggerJob {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly INTERVAL_MS = 60_000;
  private readonly DEBOUNCE_MS = 5 * 60_000;
  private lastEmitted = 0;

  constructor(private readonly eventBus: EventBus) {}

  start(): void {
    logger.info('[DailyBriefTriggerJob] Starting (60s interval)');
    this.intervalId = setInterval(() => this.check(), this.INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('[DailyBriefTriggerJob] Stopped');
    }
  }

  private check(): void {
    try {
      const config = getConfig() as any;
      const briefTime: string = config?.notifications?.dailyBriefTime ?? '08:00';
      const [targetHour, targetMinute] = briefTime.split(':').map(Number);

      const now = new Date();
      const currentHour   = now.getHours();
      const currentMinute = now.getMinutes();

      if (currentHour === targetHour && currentMinute === targetMinute) {
        const sinceLastEmit = Date.now() - this.lastEmitted;
        if (sinceLastEmit < this.DEBOUNCE_MS) {
          logger.info('[DailyBriefTriggerJob] Debounced, skipping');
          return;
        }

        const date = now.toISOString().split('T')[0];
        logger.info(`[DailyBriefTriggerJob] Emitting brief.ready for ${date}`);
        this.eventBus.emit('brief.ready', { date });
        this.lastEmitted = Date.now();
      }
    } catch (err) {
      logger.error(`[DailyBriefTriggerJob] Error: ${err}`);
    }
  }
}
