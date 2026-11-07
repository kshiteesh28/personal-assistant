import { Elysia, t } from 'elysia';
import { EventsRepository, TasksRepository, NotesRepository, RemindersRepository } from '../repositories';
import { randomUUID } from 'crypto';

export const importRouter = (
  eventsRepo: EventsRepository,
  tasksRepo: TasksRepository,
  notesRepo: NotesRepository,
  remindersRepo: RemindersRepository
) => new Elysia({ prefix: '/api/import' })
  .post('/', async ({ body }) => {
    // A simplified universal importer for CSV/JSON payloads.
    // Real implementation would parse structure, map, and insert.
    let imported = 0;
    try {
      const data = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
      
      if (data.events) {
        for (const e of data.events) {
          eventsRepo.create({ 
            title: e.title, 
            start_ts: e.start_ts, 
            end_ts: e.end_ts, 
            all_day: e.all_day 
          });
          imported++;
        }
      }
      if (data.tasks) {
        for (const t of data.tasks) {
          tasksRepo.create({ 
            title: t.title, 
            due_ts: t.due_ts, 
            priority: t.priority || 2, 
            project: t.project || null,
            status: 'todo',
            position: 0,
            time_estimate: 30,
            energy_level: 'medium',
            task_type: 'deep_work',
            is_splittable: false,
            time_preference: 'either',
            progress: 0,
            tags: t.tags || null,
            context: t.context || null
          });
           imported++;
        }
      }
      return { success: true, count: imported };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, {
    body: t.Object({
      format: t.String(), // 'json' or 'csv'
      data: t.Any()
    })
  });
