import { DowntimePipelineService } from '../../services/downtime-pipeline.service';
import { eventBus } from '../event-bus';
import { getConfig } from '../../config';

export class CheckDowntimeJob {
  private timer: NodeJS.Timer | null = null;
  private lastSuggestedTime = 0;
  private COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

  constructor(private downtimeService: DowntimePipelineService) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check();
    }, 900_000); // 15 mins
  }

  private async check() {
    const config = getConfig();
    if (!config.proactive.enabled) return;
    if (Date.now() - eventBus.lastNudgeAt < 5 * 60_000) return;

    if (Date.now() - this.lastSuggestedTime < this.COOLDOWN_MS) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const gapMinutes = await this.downtimeService.detectFreeTime(todayStr);

    if (gapMinutes > 0) {
      const suggestion = this.downtimeService.suggestForTimeSlot(gapMinutes);
      if (suggestion) {
        this.lastSuggestedTime = Date.now();
        eventBus.emit('flowstate.nudge', {
          nudgeId: `downtime-${Date.now()}`,
          category: 'checkin',
          message: `Looks like you have ${gapMinutes} minutes of free time. Want to tackle: "${suggestion.title}"?`,
          actions: [
            { label: 'Show suggestions', chatCommand: 'what should I do' },
            { label: 'Show brief', chatCommand: 'brief' }
          ]
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
