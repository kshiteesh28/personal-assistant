import { Elysia, t } from 'elysia';
import { CommandRouter } from '../orchestration/command-router';
import { parseIntent } from '../orchestration/intent-parser';
import { formatResponse } from '../orchestration/response-formatter';

export const chatRouter = (commandRouter: CommandRouter) => new Elysia({ prefix: '/api' })
  .post('/chat', async ({ body }) => {
    const parsed = parseIntent(body.message);
    const result = await commandRouter.run(parsed, body.source);
    return formatResponse(result, body.source);
  }, {
    body: t.Object({
      message: t.String(),
      source: t.Optional(t.String())
    })
  });
