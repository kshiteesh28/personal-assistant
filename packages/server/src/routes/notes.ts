import { Elysia } from 'elysia';
import { NoteService } from '../services';

export const notesRouter = (noteService: NoteService) => new Elysia({ prefix: '/api/notes' })
  .get('/', ({ query }) => {
    return noteService.findAll({ q: query.q as string, linked_event_id: query.linked_event_id as string });
  })
  .post('/', async ({ body, set }) => {
    try {
      return await noteService.create(body as any);
    } catch (e: any) {
      console.error(`[NotesRoute] POST failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .get('/:id', ({ params: { id } }) => {
    return noteService.findById(id);
  })
  .put('/:id', async ({ params: { id }, body, set }) => {
    try {
      const updated = await noteService.update(id, body as any);
      if (!updated) {
        set.status = 404;
        return { error: 'Note not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[NotesRoute] PUT failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .delete('/:id', async ({ params: { id }, set }) => {
    try {
      const success = await noteService.delete(id);
      if (!success) {
        set.status = 404;
        return { error: 'Note not found' };
      }
      set.status = 204;
      return null;
    } catch (e: any) {
      console.error(`[NotesRoute] DELETE failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  });
