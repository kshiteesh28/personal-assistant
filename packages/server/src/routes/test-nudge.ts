import { Elysia } from 'elysia';
import { eventBus } from '../scheduler/event-bus';

const DEFAULT_MESSAGES: Record<string, string> = {
  wellness: "Test nudge: Time to stretch your legs and take a moment to breathe! 🌿",
  break: "Test nudge: You've been at it for a while — consider a short break to recharge ☕",
  checkin: "Test nudge: Any new tasks or follow-ups you'd like to capture? ✅",
  motivation: "Test nudge: You're doing great — keep the momentum going! ⚡",
  summary: "Test nudge: Great work today! You accomplished a lot 🎯",
};

const WELLNESS_POOLS = {
  walk: ["Take a short walk to refresh your mind 🚶"],
  water: ["Stay hydrated — time for a glass of water 💧"],
  workout: ["Quick stretch or workout? Your body will thank you 💪"],
  meditate: ["A minute of mindfulness can reset your focus 🧘"],
  stretch: ["Stand up and stretch — you've been sitting a while 🙆"],
};

const BREAK_MESSAGES = [
  "You've been focused for a while. Step away for 5-10 minutes ☕",
  "Great focus! Now take a real mental break 🌤️",
];

const CHECKIN_MESSAGES = [
  "Any new tasks or follow-ups to capture? ✅",
  "What's on your plate? Quick add a task to stay organized 📋",
];

const MOTIVATION_POOLS = {
  morning: ["Excellent start to your day! 🌅 What's your #1 priority?"],
  midday: ["You're making great progress! Keep the momentum ⚡"],
  signoff: ["Great work today! You can be proud of what you accomplished 🎯"],
};

export const testNudgeRouter = new Elysia({ prefix: '/api' })
  .post('/test-nudge', ({ body }) => {
    const { category = 'wellness', message } = body as { category?: string; message?: string };
    const nudgeMessage = message || DEFAULT_MESSAGES[category] || DEFAULT_MESSAGES.wellness;
    const nudgeId = `test-${Date.now()}`;
    eventBus.emit('flowstate.nudge', {
      nudgeId,
      category,
      message: nudgeMessage,
      actions: category === 'checkin' ? [{ label: 'Add a task', chatCommand: '/task' }] : undefined,
    });
    return { ok: true, nudgeId, category, message: nudgeMessage };
  })
  .get('/nudge-messages/defaults', () => ({
    wellness: WELLNESS_POOLS,
    break: BREAK_MESSAGES,
    checkin: CHECKIN_MESSAGES,
    motivation: MOTIVATION_POOLS,
  }));
