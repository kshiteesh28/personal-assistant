import { UsageTrackingService } from '../../services/usage-tracking.service';
import { InsightsService } from '../../services/insights.service';
import { eventBus } from '../event-bus';
import { getConfig } from '../../config';
import { nudgeMessages } from '../../config/default-messages';

export class BreakCheckerJob {
  private timer: NodeJS.Timer | null = null;
  private lastSuggestedTime = 0;
  private COOLDOWN_MS = 30 * 60 * 1000;

  constructor(
    private usageService: UsageTrackingService,
    private insightsService: InsightsService
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check();
    }, 60000);
  }

  private check() {
    const config = getConfig();
    if (!config.tracking.enabled || !config.notifications.triggers.breakReminder) return;

    if (!eventBus.canNudge()) return;
    if (Date.now() - this.lastSuggestedTime < this.COOLDOWN_MS) return;

    if (this.insightsService.shouldSuggestBreak()) {
      const startInfo = this.usageService.getCurrentFocusBlockStartTs();
      const durationMin = Math.round((Date.now() - startInfo) / 60000);
      
      if (durationMin >= config.tracking.focusBlockMaxMinutes) {
        const pool = config.nudgeMessages.break?.length 
          ? config.nudgeMessages.break 
          : nudgeMessages.break;
        const msg = pool[Math.floor(Math.random() * pool.length)].replace('${durationMin}', durationMin.toString());

        this.lastSuggestedTime = Date.now();
        eventBus.emit('break.suggested', {
          activityType: 'focus',
          durationMin,
          message: msg
        });
      }
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
