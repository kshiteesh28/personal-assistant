import { Elysia } from 'elysia';
import { CalendarService } from '../services';

export const eventsRouter = (calendarService: CalendarService) => new Elysia({ prefix: '/api/events' })
  .get('/', ({ query }) => {
    if (!query.start || !query.end) throw new Error("Missing start/end query parameters");
    return calendarService.findAll(parseInt(query.start as string, 10), parseInt(query.end as string, 10));
  })
  .post('/', async ({ body, query, set }) => {
    try {
      const data = body as any;
      if (query.force !== 'true') {
        const conflictTask = await calendarService.checkTaskConflict(data.start_ts, data.end_ts);
        if (conflictTask) {
          set.status = 409;
          return { error: 'Conflict with deep work', task: conflictTask };
        }
      }
      return await calendarService.create(data);
    } catch (e: any) {
      console.error(`[EventsRoute] POST failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .post('/suggest-alternative', async ({ body }) => {
     const { eventTitle } = body as any;
     // In a real app we'd find the next free slot. For now, we follow the requirement.
     return { 
       success: true, 
       message: `Alternative suggested: "I have a deep work session then. How about 4:00 PM instead for ${eventTitle}?"` 
     };
  })
  .get('/:id', ({ params: { id } }) => {
    return calendarService.findById(id);
  })
  .put('/:id', async ({ params: { id }, body, set }) => {
    try {
      const updated = await calendarService.update(id, body as any);
      if (!updated) {
        set.status = 404;
        return { error: 'Event not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[EventsRoute] PUT failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .delete('/:id', async ({ params: { id }, set }) => {
    try {
      const success = await calendarService.delete(id);
      if (!success) {
        set.status = 404;
        return { error: 'Event not found' };
      }
      set.status = 204;
      return null;
    } catch (e: any) {
      console.error(`[EventsRoute] DELETE failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .post('/parse-text', ({ body }: any) => {
    return { message: "Stub for parsing: " + body.text };
  });
