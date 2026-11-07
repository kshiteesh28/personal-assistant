import { Task } from '@secretary/shared';
import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export class TasksRepository extends BaseRepository<Task> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'tasks');
  }

  findByStatus(status: string): Task[] {
    return this.db.query<Task, any>(`SELECT * FROM tasks WHERE status = $status ORDER BY position ASC, due_ts ASC`).all({ $status: status });
  }

  findByDueDate(startMs: number, endMs: number): Task[] {
    return this.db.query<Task, any>(`SELECT * FROM tasks WHERE due_ts >= $start AND due_ts <= $end ORDER BY due_ts ASC`)
      .all({ $start: startMs, $end: endMs });
  }

  findOverdue(nowMs: number): Task[] {
    const todayStart = new Date(nowMs).setHours(0, 0, 0, 0);
    return this.db.query<Task, any>(`SELECT * FROM tasks WHERE status IN ('todo', 'in_progress') AND due_ts < $todayStart ORDER BY due_ts ASC`)
      .all({ $todayStart: todayStart });
  }

  findPinnedTodos(): Task[] {
    return this.db.query<Task, any>(`SELECT * FROM tasks WHERE status IN ('todo', 'in_progress') AND pinned_time IS NOT NULL`).all();
  }

  create(data: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Task {
    const now = Date.now();
    const id = randomUUID();
    const task: Task = {
      id,
      ...data,
      created_at: now,
      updated_at: now
    };

    this.db.query(`
      INSERT INTO tasks (
        id, title, due_ts, priority, status, project, tags, 
        position, time_estimate, energy_level, task_type, is_splittable, 
        context, time_preference, pinned_time, progress, created_at, updated_at
      ) VALUES (
        $id, $title, $due_ts, $priority, $status, $project, $tags,
        $position, $time_estimate, $energy_level, $task_type, $is_splittable,
        $context, $time_preference, $pinned_time, $progress, $created_at, $updated_at
      )
    `).run({
      $id: task.id,
      $title: task.title,
      $due_ts: task.due_ts || null,
      $priority: task.priority,
      $status: task.status,
      $project: task.project || null,
      $tags: task.tags || null,
      $position: task.position,
      $time_estimate: task.time_estimate,
      $energy_level: task.energy_level,
      $task_type: task.task_type,
      $is_splittable: task.is_splittable ? 1 : 0,
      $context: task.context || null,
      $time_preference: task.time_preference,
      $pinned_time: task.pinned_time || null,
      $progress: task.progress || 0,
      $created_at: task.created_at,
      $updated_at: task.updated_at
    });

    return task;
  }

  update(id: string, updates: Partial<Task>): Task | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updated_at: Date.now() };

    this.db.query(`
      UPDATE tasks SET
        title = $title, due_ts = $due_ts, priority = $priority, status = $status,
        project = $project, tags = $tags, position = $position, time_estimate = $time_estimate,
        energy_level = $energy_level, task_type = $task_type, is_splittable = $is_splittable,
        context = $context, time_preference = $time_preference, pinned_time = $pinned_time,
        progress = $progress, updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: merged.id,
      $title: merged.title,
      $due_ts: merged.due_ts || null,
      $priority: merged.priority,
      $status: merged.status,
      $project: merged.project || null,
      $tags: merged.tags || null,
      $position: merged.position,
      $time_estimate: merged.time_estimate,
      $energy_level: merged.energy_level,
      $task_type: merged.task_type,
      $is_splittable: merged.is_splittable ? 1 : 0,
      $context: merged.context || null,
      $time_preference: merged.time_preference,
      $pinned_time: merged.pinned_time || null,
      $progress: merged.progress || 0,
      $updated_at: merged.updated_at
    });

    return merged;
  }

  updatePositions(orderedIds: string[]): void {
    const stmt = this.db.query(`UPDATE tasks SET position = $pos, updated_at = $updatedAt WHERE id = $id`);
    this.db.transaction(() => {
      const now = Date.now();
      orderedIds.forEach((id, index) => {
        stmt.run({ $pos: index, $updatedAt: now, $id: id });
      });
    })();
  }
}
