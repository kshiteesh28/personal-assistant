import { Elysia } from 'elysia';
import { BriefingService } from '../services';

export const briefRouter = (briefingService: BriefingService) => new Elysia({ prefix: '/api/brief' })
  .get('/:date', ({ params: { date } }) => {
    return briefingService.getBriefForDate(date);
  });
