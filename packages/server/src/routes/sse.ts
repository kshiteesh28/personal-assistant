import { Elysia } from 'elysia';
import { eventBus } from '../scheduler/event-bus';
import { Stream } from '@elysiajs/stream';
import { logger } from '../config/logger';

export const sseRouter = new Elysia({ prefix: '/api/events/stream' })
  .get('/', () => {
    logger.info('[SSE] New client connection');
    
    return new Stream((stream) => {
      const id = Math.random().toString(36).substring(7);
      
      const dispatch = async (type: string, payload: any) => {
        try {
          await stream.send({ type, payload });
        } catch (err) {
          // Handled by close event
        }
      };

      const listeners: Record<string, (p: any) => void> = {
        'reminder.due': (p) => dispatch('reminder.due', p),
        'break.suggested': (p) => dispatch('break.suggested', p),
        'brief.ready': (p) => dispatch('brief.ready', p),
        'meeting.approaching': (p) => dispatch('meeting.approaching', p),
        'data.changed': (p) => dispatch('data.changed', p),
        'flowstate.nudge': (p) => dispatch('flowstate.nudge', p),
        'secretary.nudge': (p) => dispatch('secretary.nudge', p),
        'config.changed': (p) => dispatch('config.changed', p)
      };

      for (const [event, listener] of Object.entries(listeners)) {
        eventBus.on(event, listener);
      }

      const keepaliveIntervalId = setInterval(() => {
        dispatch('keepalive', { timestamp: Date.now() });
      }, 30000);

      // Setup cleanup on stream close
      (stream as any).on('close', () => {
        logger.info(`[SSE] Cleaning up client ${id}`);
        clearInterval(keepaliveIntervalId);
        for (const [event, listener] of Object.entries(listeners)) {
          eventBus.off(event, listener);
        }
      });
    });
  });
