import { EventBus } from '../event-bus';
import { RemindersRepository } from '../../repositories/reminders.repository';
import { logger } from '../../config/logger';

/**
 * ReminderCheckerJob — runs every 60 seconds.
 * Finds all active reminders whose trigger_ts has passed,
 * emits reminder.due SSE events, and marks them dismissed.
 */
export class ReminderCheckerJob {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly INTERVAL_MS = 60_000;

  constructor(
    private readonly remindersRepo: RemindersRepository,
    private readonly eventBus: EventBus,
  ) {}

  start(): void {
    logger.info('[ReminderCheckerJob] Starting');
    this.run();
  }

  stop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = undefined;
      logger.info('[ReminderCheckerJob] Stopped');
    }
  }

  private async run(): Promise<void> {
    await this.check();
    this.intervalId = setTimeout(() => this.run(), this.INTERVAL_MS);
  }

  private async check(): Promise<void> {
    try {
      const now = Date.now();
      const due = this.remindersRepo.findDue(now); // Removed await as it's not a promise
      for (const reminder of due) {
        logger.info(`[ReminderCheckerJob] Reminder due: "${reminder.title}" (${reminder.id})`);
        this.eventBus.emit('reminder.due', {
          id: reminder.id,
          title: reminder.title,
          trigger_ts: reminder.trigger_ts,
        });

        if (reminder.repeat_rule) {
          const next = this.nextTrigger(reminder.trigger_ts, reminder.repeat_rule, now);
          this.remindersRepo.update(reminder.id, { trigger_ts: next });
        } else {
          this.remindersRepo.update(reminder.id, { status: 'dismissed' });
        }
      }
    } catch (err) {
      logger.error(`[ReminderCheckerJob] Error: ${err}`);
    }
  }

  private nextTrigger(ts: number, rule: string, now: number): number {
    const MS_DAY  = 86_400_000;
    const MS_WEEK = 7 * MS_DAY;
    let next = ts;
    const interval = rule === 'weekly' ? MS_WEEK : MS_DAY;
    
    // Fast-forward to the next future occurrence
    while (next <= now) {
      next += interval;
    }
    return next;
  }
}
