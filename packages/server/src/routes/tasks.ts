import { Elysia } from 'elysia';
import { TaskService } from '../services';

export const tasksRouter = (taskService: TaskService) => new Elysia({ prefix: '/api/tasks' })
  .get('/', ({ query }) => {
    return taskService.findAll({
      status: query.status as string,
      priority: query.priority ? parseInt(query.priority as string, 10) : undefined,
      due_before: query.due_before ? parseInt(query.due_before as string, 10) : undefined
    });
  })
  .post('/', async ({ body, set }) => {
    try {
      return await taskService.create(body as any);
    } catch (e: any) {
      console.error(`[TasksRoute] POST failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .put('/reorder', async ({ body, set }: any) => {
    try {
      await taskService.reorder(body.ordered_ids);
      return { success: true };
    } catch (e: any) {
      console.error(`[TasksRoute] Reorder failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .get('/:id', ({ params: { id } }) => {
    return taskService.findById(id);
  })
  .put('/:id', async ({ params: { id }, body, set }) => {
    try {
      const updated = await taskService.update(id, body as any);
      if (!updated) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[TasksRoute] PUT failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .patch('/:id/progress', async ({ params: { id }, body, set }: any) => {
    try {
      const updated = await taskService.updateProgress(id, body.progress);
      if (!updated) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[TasksRoute] Patch progress failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .post('/:id/negotiate-reschedule', async ({ params: { id }, set }) => {
    try {
      const updated = await taskService.negotiateReschedule(id);
      if (!updated) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      return updated;
    } catch (e: any) {
      console.error(`[TasksRoute] Reschedule failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  })
  .delete('/:id', async ({ params: { id }, set }) => {
    try {
      const success = await taskService.delete(id);
      if (!success) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      set.status = 204;
      return null;
    } catch (e: any) {
      console.error(`[TasksRoute] DELETE failed: ${e.message}`);
      set.status = 500;
      return { error: e.message };
    }
  });
