import { Elysia, t } from 'elysia';
import { ChecklistsRepository } from '../repositories';

export const checklistsRouter = (repo: ChecklistsRepository) => new Elysia({ prefix: '/api/checklists' })
  .get('/', () => repo.findAllParsed())
  .post('/', ({ body }) => repo.create(body.name, body.items, body.is_template), {
    body: t.Object({
      name: t.String(),
      items: t.Array(t.String()),
      is_template: t.Optional(t.Boolean())
    })
  })
  .patch('/:id', ({ params, body }) => repo.update(params.id, body.name, body.items), {
    body: t.Object({
      name: t.Optional(t.String()),
      items: t.Optional(t.Array(t.String()))
    })
  })
  .delete('/:id', ({ params }) => {
    repo.delete(params.id);
    return { success: true };
  });
