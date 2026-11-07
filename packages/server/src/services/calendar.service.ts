import { EventsRepository, TasksRepository, DailySchedulesRepository } from '../repositories';
import { Event, EventCreate, Task } from '@secretary/shared';

export class CalendarService {
  constructor(
    private eventsRepo: EventsRepository,
    private tasksRepo: TasksRepository,
    private schedulesRepo: DailySchedulesRepository
  ) {}

  findAll(startMs: number, endMs: number): Event[] {
    return this.eventsRepo.findByDateRange(startMs, endMs);
  }

  findById(id: string): Event | null {
    return this.eventsRepo.findById(id);
  }

  async checkTaskConflict(startTs: number, endTs: number): Promise<Task | null> {
    const dateStr = new Date(startTs).toISOString().split('T')[0];
    const schedule = this.schedulesRepo.findByDate(dateStr);
    if (!schedule) return null;

    // Check overlaps with blocks of type 'task'
    const overlap = schedule.blocks.find(b => {
      if (b.type !== 'task') return false;
      const bStart = b.start_ts;
      const bEnd = b.end_ts;
      return (startTs < bEnd && endTs > bStart);
    });

    if (overlap && overlap.task_id) {
      const task = this.tasksRepo.findById(overlap.task_id);
      if (task && (task.energy_level === 'high' || task.pinned_time != null)) {
        return task;
      }
    }
    return null;
  }

  create(data: EventCreate): Event {
    return this.eventsRepo.create({
      all_day: false,
      ...data
    });
  }

  update(id: string, updates: Partial<Event>): Event | null {
    return this.eventsRepo.update(id, updates);
  }

  delete(id: string): boolean {
    return this.eventsRepo.delete(id);
  }
}
