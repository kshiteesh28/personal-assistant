import { EventsRepository, TasksRepository, NotesRepository, RemindersRepository } from '../../repositories';
import { Task } from '@secretary/shared';
import { eventBus } from '../event-bus';
import { NotificationService } from '../../services/notification.service';

export class TaskDeadlineCheckerJob {
  private timer: NodeJS.Timer | null = null;
  private notifiedTaskIds = new Set<string>();

  constructor(
    private taskRepo: TasksRepository,
    private notificationService: NotificationService
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check();
    }, 300_000); // 5 mins
  }

  private check() {
    // Respect global nudge cooldown
    if (Date.now() - eventBus.lastNudgeAt < 5 * 60_000) return;

    const allTodo = this.taskRepo.findByStatus('todo');
    const pinned = allTodo.filter(t => t.pinned_time != null);
    
    const now = Date.now();
    const todayMidnight = new Date();
    todayMidnight.setHours(0,0,0,0);
    const msSinceMidnight = now - todayMidnight.getTime();

    for (const task of pinned) {
      if (task.pinned_time == null) continue;
      const pinnedMs = task.pinned_time * 60000;
      const elapsed = msSinceMidnight - pinnedMs;

      // Between 5 and 10 minutes overdue
      if (elapsed >= 300_000 && elapsed <= 600_000) {
        if (!this.notifiedTaskIds.has(task.id)) {
          this.notifiedTaskIds.add(task.id);

          this.notificationService.notify(
            'Task Overdue',
            `You planned to work on "${task.title}" 5 minutes ago.`
          );

          eventBus.emit('flowstate.nudge', {
            nudgeId: `deadline-${task.id}`,
            category: 'checkin',
            message: `You planned to work on "${task.title}". Did you get started?`,
            actions: [
              { label: 'Mark complete', chatCommand: `/complete ${task.title}` },
              { label: 'View tasks', chatCommand: '/tasks' }
            ]
          });
          
          // Clean up the set after 1 hour (hacky but works for the scope)
          setTimeout(() => {
            this.notifiedTaskIds.delete(task.id);
          }, 60 * 60 * 1000);
        }
      }
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.notifiedTaskIds.clear();
  }
}
