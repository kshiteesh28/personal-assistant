import { Elysia } from 'elysia';
import { EventsRepository, TasksRepository, NotesRepository, RemindersRepository } from '../repositories';

export const exportRouter = (
  eventsRepo: EventsRepository,
  tasksRepo: TasksRepository,
  notesRepo: NotesRepository,
  remindersRepo: RemindersRepository
) => new Elysia({ prefix: '/api/export' })
  .get('/', () => {
    // Simple JSON dump of core tables
    const data = {
      events: eventsRepo.findByDateRange(0, Date.now() + 31536000000), // ~1 year
      tasks: tasksRepo.findByStatus('todo'),
      notes: notesRepo.findAll(),
      reminders: remindersRepo.findAll()
    };
    
    return data;
  });
