import { Elysia } from 'elysia';
import { ReminderService } from '../services';

export const remindersRouter = (reminderService: ReminderService) => new Elysia({ prefix: '/api/reminders' })
  .get('/', ({ query }) => {
    return reminderService.findAll({ status: query.status as string });
  })
  .post('/', async ({ body, set }) => {
    try {
      return await reminderService.create(body as any);
    } catch (e: any) {
      console.error(`[RemindersRoute] POST failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .get('/:id', ({ params: { id } }) => {
    return reminderService.findById(id);
  })
  .put('/:id', async ({ params: { id }, body, set }) => {
    try {
      const updated = await reminderService.update(id, body as any);
      if (!updated) {
        set.status = 404;
        return { error: 'Reminder not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[RemindersRoute] PUT failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .patch('/:id', async ({ params: { id }, body, set }) => {
    try {
      const updated = await reminderService.update(id, body as any);
      if (!updated) {
        set.status = 404;
        return { error: 'Reminder not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[RemindersRoute] PATCH failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .delete('/:id', async ({ params: { id }, set }) => {
    try {
      const success = await reminderService.delete(id);
      if (!success) {
        set.status = 404;
        return { error: 'Reminder not found' };
      }
      set.status = 204;
      return null;
    } catch (e: any) {
      console.error(`[RemindersRoute] DELETE failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  });
