import { EventEmitter } from 'events';

export class EventBus extends EventEmitter {
  public lastNudgeAt: number = 0;

  public emit(eventName: string | symbol, ...args: any[]): boolean {
    const nudgeEvents = ['flowstate.nudge', 'break.suggested', 'reminder.due', 'meeting.approaching', 'brief.ready'];
    if (typeof eventName === 'string' && nudgeEvents.includes(eventName)) {
      this.lastNudgeAt = Date.now();
    }
    return super.emit(eventName, ...args);
  }

  public canNudge(cooldownMs: number = 600_000): boolean {
    return (Date.now() - this.lastNudgeAt) >= cooldownMs;
  }
}

export const eventBus = new EventBus();
