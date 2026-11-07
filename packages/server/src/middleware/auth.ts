import { Elysia } from 'elysia';
import { getConfig } from '../config';

export const authMiddleware = new Elysia({ name: 'auth' })
  .derive(({ headers }) => {
    const authHeader = headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error("UNAUTHORIZED");
    }
    const token = authHeader.substring(7);
    const config = getConfig();
    if (token !== config.server.authToken) {
      console.warn(`[Auth] Token mismatch: received "${token}", expected "${config.server.authToken}"`);
      throw new Error("UNAUTHORIZED");
    }
    return { user: 'admin' };
  });

export const requireAuth = (app: Elysia) => app.use(authMiddleware);
