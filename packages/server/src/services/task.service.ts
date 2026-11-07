import { TasksRepository } from '../repositories';
import { Task, TaskCreate } from '@secretary/shared';

import { EventBus } from '../scheduler/event-bus';

export class TaskService {
  constructor(private tasksRepo: TasksRepository, private eventBus: EventBus) {}

  findAll(filters?: { status?: string | string[]; priority?: number; due_before?: number }): Task[] {
    let tasks: Task[] = [];
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        tasks = filters.status.flatMap(s => this.tasksRepo.findByStatus(s));
      } else {
        tasks = this.tasksRepo.findByStatus(filters.status);
      }
    } else {
      tasks = this.tasksRepo.findAll();
    }
    
    if (filters?.priority) tasks = tasks.filter(t => t.priority === filters.priority);
    if (filters?.due_before) tasks = tasks.filter(t => t.due_ts && t.due_ts <= filters.due_before!);
    
    return tasks;
  }

  findById(id: string): Task | null {
    return this.tasksRepo.findById(id);
  }

  create(data: TaskCreate): Task {
    const today11PM = new Date();
    today11PM.setHours(23, 0, 0, 0);

    const defaultData = {
      priority: 2 as const,
      status: "todo" as const,
      position: 0,
      time_estimate: 30,
      energy_level: "medium" as const,
      task_type: "deep_work" as const,
      is_splittable: false,
      time_preference: "either" as const,
      progress: 0,
      due_ts: today11PM.getTime(),
      ...data
    };
    if (data.due_ts && data.due_ts < Date.now() - 60000) {
      throw new Error('Task deadline cannot be in the past');
    }

    return this.tasksRepo.create(defaultData);
  }

  update(id: string, updates: Partial<Task>): Task | null {
    const task = this.tasksRepo.update(id, updates);
    if (task) this.eventBus.emit('data.changed', { id, action: 'update' });
    return task;
  }

  updateProgress(id: string, progress: number): Task | null {
    const clamped = Math.max(0, Math.min(100, progress));
    const updates: Partial<Task> = { progress: clamped };
    if (clamped === 100) updates.status = 'done';
    else if (clamped > 0) updates.status = 'in_progress';
    else updates.status = 'todo';
    
    const task = this.tasksRepo.update(id, updates);
    if (task) this.eventBus.emit('data.changed', { id, action: 'progress' });
    return task;
  }

  reorder(orderedIds: string[]): void {
    this.tasksRepo.updatePositions(orderedIds);
  }

  negotiateReschedule(id: string): Task | null {
    const task = this.tasksRepo.findById(id);
    if (!task) return null;

    // Calculate tomorrow at 8:00 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);

    return this.tasksRepo.update(id, {
      due_ts: tomorrow.getTime(),
      pinned_time: 480 // 8:00 AM is the start of High Energy band
    });
  }

  delete(id: string): boolean {
    return this.tasksRepo.delete(id);
  }
}
