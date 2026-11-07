import { Elysia, t } from 'elysia';
import { WeeklyReviewsRepository } from '../repositories';

export const weeklyReviewsRouter = (repo: WeeklyReviewsRepository) => new Elysia({ prefix: '/api/weekly-reviews' })
  .get('/', () => repo.findAllParsed())
  .get('/:weekStart', ({ params }) => {
    const res = repo.findByWeek(params.weekStart);
    if (!res) throw new Error('Not found');
    return res;
  })
  .post('/', ({ body }) => repo.create(body.week_start, body.what_worked, body.what_to_refine, body.improvements), {
    body: t.Object({
      week_start: t.String(),
      what_worked: t.String(),
      what_to_refine: t.String(),
      improvements: t.Array(t.String())
    })
  });
