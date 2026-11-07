import { UsageTrackingService } from '../../services/usage-tracking.service';
import { getConfig } from '../../config';

export class UsageSamplerJob {
  private timer: NodeJS.Timer | null = null;

  constructor(private usageService: UsageTrackingService) {}

  start() {
    if (this.timer) return;
    const interval = getConfig().tracking.samplingIntervalMs || 60000;
    this.timer = setInterval(async () => {
      if (!getConfig().tracking.enabled) return;
      try {
        await this.usageService.sample();
      } catch (e) {
        // Ignore sampling errors
      }
    }, interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
