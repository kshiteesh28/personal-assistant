import { eventBus } from './event-bus';
import { getConfig } from '../config';

export class ProactiveNudgeEngine {
  private timer: NodeJS.Timer | null = null;
  private wellnessCategoryIdx = 0;
  private lastWellnessAt = 0;
  private lastBreakAt = 0;

  private WELLNESS_ORDER = ["walk", "water", "workout", "meditate", "stretch"];

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 60000);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const config = getConfig().proactive;
    if (!config.enabled) return;

    const now = new Date();
    // Simplified checks
    this.checkWellness(now, config);
    // Add checkBreak, checkTaskCheckin, etc. 
  }

  private checkWellness(now: Date, config: any) {
    if (!config.wellnessEnabled) return;
    const nowMs = now.getTime();
    if (nowMs - this.lastWellnessAt >= config.wellnessIntervalMin * 60000) {
      const category = this.WELLNESS_ORDER[this.wellnessCategoryIdx];
      this.wellnessCategoryIdx = (this.wellnessCategoryIdx + 1) % this.WELLNESS_ORDER.length;
      
      eventBus.emit('flowstate.nudge', {
        nudgeId: `wellness_${nowMs}`,
        category: 'wellness',
        message: `Time for a wellness break: ${category}`,
        actions: []
      });
      
      this.lastWellnessAt = nowMs;
    }
  }
}
