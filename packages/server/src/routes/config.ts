import { Elysia, t } from 'elysia';
import { getConfig, setConfig, loadConfig, ConfigSchema } from '../config';
import { eventBus } from '../scheduler/event-bus';
import { writeFileSync } from 'fs';
import { join } from 'path';

export const configRouter = new Elysia({ prefix: '/api/config' })
  .get('/', () => {
    const cfg = getConfig();
    return { ...cfg, trackingUnavailable: false };
  })
  .patch('/', ({ body }) => {
    const current = getConfig();
    const merged = { ...current, ...(body as any) };
    setConfig(merged);
    
    // Save to file (simplified)
    const p = process.env.CONFIG_PATH || join(process.cwd(), "..", "..", "config.json");
    writeFileSync(p, JSON.stringify(merged, null, 2), 'utf-8');

    // Emit config.changed for keys that changed
    Object.keys(body as any).forEach(key => {
      eventBus.emit('config.changed', { section: key });
    });

    return merged;
  });
