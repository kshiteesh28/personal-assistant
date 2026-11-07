import { Elysia } from 'elysia';
import { IntegrationPlugin } from '../integrations/plugin-registry';

export const integrationsRouter = (plugins: IntegrationPlugin[]) => new Elysia({ prefix: '/api/integrations' })
  .get('/', () => {
    return plugins.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      enabled: p.enabled
    }));
  });
