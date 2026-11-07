import Elysia from 'elysia';
import { OutlookCalendarService } from '../services/outlook-calendar.service';
import { logger } from '../config/logger';

const outlookCalendarService = new OutlookCalendarService();

export const outlookCalendarRouter = new Elysia({ prefix: '/api/outlook' })
  .get('/calendar', async ({ query }) => {
    const start = Number(query.start ?? 0);
    const end   = Number(query.end ?? Date.now() + 7 * 86400_000);

    if (!start || !end) {
      return new Response(JSON.stringify({ error: 'start and end query params required' }), { status: 400 });
    }

    try {
      const events = await outlookCalendarService.getEvents(start, end);
      // Return in standard format + mark source
      return events.map(e => ({ ...outlookCalendarService.toSharedEvent(e as any), source: 'outlook' }));
    } catch (err) {
      logger.warn(`[outlook-calendar route] Failed: ${err}`);
      return [];
    }
  });
