import { Elysia, t } from 'elysia';
import { DowntimePipelineRepository } from '../repositories';

export const downtimePipelineRouter = (repo: DowntimePipelineRepository) => new Elysia({ prefix: '/api/downtime' })
  .get('/', () => repo.findByStatus('queued'))
  .post('/', ({ body }) => repo.create(body.title, body.category, body.estimated_mins, body.priority), {
    body: t.Object({
      title: t.String(),
      category: t.Optional(t.String()),
      estimated_mins: t.Optional(t.Number()),
      priority: t.Optional(t.Number())
    })
  })
  .post('/:id/complete', ({ params }) => {
    repo.markComplete(params.id);
    return { success: true };
  })
  .delete('/:id', ({ params }) => {
    repo.delete(params.id);
    return { success: true };
  })
  .get('/suggestions/:minutes', ({ params }) => {
    return repo.findSuggestions(parseInt(params.minutes));
  });
