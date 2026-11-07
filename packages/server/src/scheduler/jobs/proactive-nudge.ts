import { EventBus } from '../event-bus';
import { getConfig } from '../../config';
import { PresentationDetectorService } from '../../services/presentation-detector.service';
import { logger } from '../../config/logger';

type NudgeCategory = 'wellness' | 'break' | 'checkin' | 'motivation';

interface NudgeCooldown {
  lastFired: number;
  cooldownMs: number;
}

/**
 * ProactiveNudgeJob — 60s interval.
 * Fires wellness, break, checkin, and motivation nudges based on
 * time-of-day rules and config toggles, respecting cooldowns.
 * Suppressed during presentations.
 */
export class ProactiveNudgeJob {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly INTERVAL_MS = 60_000;
  private readonly detector = new PresentationDetectorService();

  private cooldowns: Record<NudgeCategory, { lastFired: number }> = {
    wellness:   { lastFired: 0 },
    break:      { lastFired: 0 },
    checkin:    { lastFired: 0 },
    motivation: { lastFired: 0 },
  };

  private readonly NUDGE_MESSAGES: Record<NudgeCategory, string[]> = {
    wellness: [
      "💧 Time to hydrate! Drink a glass of water.",
      "🧘 Quick posture check — sit up straight and breathe.",
      "👁️ 20-20-20 rule: look at something 20 feet away for 20 seconds.",
      "🌿 Step away from the screen for 2 minutes.",
    ],
    break: [
      "☕ Great work! Take a 5-minute break.",
      "🚶 Stand up and stretch for a couple of minutes.",
      "🎵 Rest your mind — take a short break.",
      "🌈 Good progress! You deserve a breather.",
    ],
    checkin: [
      "📋 Quick check-in: anything you want to add to your task list?",
      "🎯 How's your energy right now? Adjust your plan if needed.",
      "🗒️ Mid-session check: are you still on track?",
    ],
    motivation: [
      "⚡ You've got this! Keep up the great work.",
      "🚀 Every step forward counts — you're doing amazing.",
      "🔥 Stay focused. The results are worth it.",
      "💪 Deep work in progress — you're in the zone!",
    ],
  };

  private currentMessageIndices: Record<NudgeCategory, number> = {
    wellness: 0,
    break: 0,
    checkin: 0,
    motivation: 0
  };

  constructor(private readonly eventBus: EventBus) {
    const now = Date.now();
    // Initialize lastFired to now so we don't burst on startup
    Object.keys(this.cooldowns).forEach(cat => {
      this.cooldowns[cat as NudgeCategory].lastFired = now;
    });

    // Shuffle the pools once at startup to randomize the sequence
    Object.keys(this.NUDGE_MESSAGES).forEach(cat => {
      this.NUDGE_MESSAGES[cat as NudgeCategory].sort(() => Math.random() - 0.5);
    });
  }

  start(): void {
    if (this.intervalId) return;
    logger.info('[ProactiveNudgeJob] Starting (60s interval)');
    this.intervalId = setInterval(() => this.check(), this.INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async check(): Promise<void> {
    try {
      const config = getConfig() as any;
      const proactive = config?.proactive;
      if (!proactive?.enabled) return;

      if (await this.detector.shouldSuppressNudges()) {
        logger.info('[ProactiveNudgeJob] Suppressed — presenting');
        return;
      }

      const hour = new Date().getHours();
      const workStart = parseInt((proactive.workHoursStart ?? '09:00').split(':')[0]);
      const workEnd   = parseInt((proactive.workHoursEnd   ?? '18:00').split(':')[0]);
      const inWorkHours = hour >= workStart && hour < workEnd;

      if (!inWorkHours) return;

      // Each category runs on its OWN independent cooldown from settings
      if (proactive.wellnessEnabled !== false) {
        this.maybeNudge('wellness', (proactive.wellnessIntervalMin || 90) * 60_000);
      }
      if (proactive.breakEnabled !== false) {
        this.maybeNudge('break', (proactive.breakReminderCooldownMin || 60) * 60_000);
      }
      if (proactive.checkinEnabled !== false) {
        this.maybeNudge('checkin', (proactive.taskCheckinCooldownMin || 180) * 60_000);
      }
      if (proactive.motivationEnabled !== false) {
        this.maybeNudge('motivation', (proactive.motivationIntervalMin || 120) * 60_000);
      }
    } catch (err) {
      logger.error(`[ProactiveNudgeJob] Error: ${err}`);
    }
  }

  private maybeNudge(category: NudgeCategory, cooldownMs: number): boolean {
    const cd = this.cooldowns[category];
    const now = Date.now();
    
    // 1. Check individual category cooldown (This is what you set in settings)
    if (now - cd.lastFired < cooldownMs) return false;

    // 2. Micro-stagger: don't fire if ANY other nudge was fired in the last 10 seconds.
    // This allows different categories to fire in the same minute, but prevents them from popping at the exact same time.
    if (!this.eventBus.canNudge(10_000)) return false;

    // 3. Monotony Guard: Pick the next message in the rotation for THIS category
    const messages = this.NUDGE_MESSAGES[category];
    const idx = this.currentMessageIndices[category];
    const message = messages[idx];
    
    // Advance index for this specific pool
    this.currentMessageIndices[category] = (idx + 1) % messages.length;

    logger.info(`[NudgeSystem] Nudge: ${category} — "${message}"`);
    this.eventBus.emit('flowstate.nudge', { category, message });
    cd.lastFired = now;

    return true;
  }
}
