import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { decodeStrictJSON } from '../wire-json.mjs';

const MAX_FRAME_BYTES = 512 * 1024;

function makeFault(code, message, status = 503) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Unified Native System Broker client over the private owner-only Unix domain socket.
 * Supports:
 * 1. Request/response calls to `AppleEcosystemBroker` (`apple.execute`)
 * 2. Streaming inference calls to `LocalIntelligenceBroker` (`llm.infer.start`, `llm.infer.cancel`)
 *    with bidirectional `core.tool.execute` callbacks executed by the Node.js core authority.
 */
export function createNativeBrokerClient({ socketPath, capability, timeoutMs = 8000 } = {}) {
  let currentPath = socketPath ?? null;
  let currentCapability = capability ?? null;
  let active = 0;
  let closed = false;
  const sockets = new Set();

  function updateEndpoint({ socketPath: nextPath, capability: nextCap } = {}) {
    if (typeof nextPath === 'string' && nextPath.startsWith('/private/tmp/kst-') && typeof nextCap === 'string' && nextCap.length >= 32) {
      currentPath = nextPath;
      currentCapability = nextCap;
      return true;
    }
    return false;
  }

  function writeFrame(socket, payload) {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    if (data.length > MAX_FRAME_BYTES) throw makeFault('BROKER_FRAME_LIMIT', 'Native broker payload exceeds frame limit.');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length, 0);
    socket.write(Buffer.concat([header, data]));
  }

  async function call(method, params = {}, callTimeoutMs = timeoutMs) {
    if (closed || !currentPath || !currentCapability) {
      throw makeFault('BROKER_UNAVAILABLE', 'Open kst native app to pair Apple native services and local intelligence.', 503);
    }
    if (active >= 12) {
      throw makeFault('BROKER_BUSY', 'Native broker is busy.', 429);
    }
    active++;
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = Buffer.alloc(0);
      const id = randomUUID();
      const socket = net.createConnection({ path: currentPath });
      sockets.add(socket);

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        active--;
        sockets.delete(socket);
        clearTimeout(timer);
        socket.destroy();
        error ? reject(error) : resolve(result);
      };

      const timer = setTimeout(() => finish(makeFault('BROKER_TIMEOUT', 'Native broker did not respond within deadline.')), callTimeoutMs);
      socket.on('error', () => finish(makeFault('BROKER_UNAVAILABLE', 'Native broker connection failed.')));
      socket.on('end', () => finish(makeFault('BROKER_UNAVAILABLE', 'Native broker closed before replying.')));
      socket.on('connect', () => {
        try {
          writeFrame(socket, {
            schemaVersion: 1,
            id,
            capability: currentCapability,
            method,
            params
          });
        } catch (err) {
          finish(err);
        }
      });
      socket.on('data', (part) => {
        buffer = Buffer.concat([buffer, part]);
        while (buffer.length >= 4) {
          const length = buffer.readUInt32BE(0);
          if (length <= 0 || length > MAX_FRAME_BYTES) {
            return finish(makeFault('BROKER_FRAME_LIMIT', 'Invalid native broker frame.'));
          }
          if (buffer.length < 4 + length) return;
          const frameBytes = buffer.subarray(4, 4 + length);
          buffer = buffer.subarray(4 + length);
          try {
            const response = decodeStrictJSON(frameBytes);
            if (response.id !== id) throw new Error('Mismatched frame ID');
            if (response.error) {
              return finish(makeFault(response.error.code ?? 'BROKER_ERROR', response.error.message ?? 'Native broker operation failed.', response.error.status ?? 400));
            }
            return finish(null, response.result);
          } catch {
            return finish(makeFault('BROKER_PROTOCOL', 'Invalid native broker response.'));
          }
        }
      });
    });
  }

  /**
   * Executes a local LLM turn via `LocalIntelligenceBroker` in Swift, supporting:
   * - Bidirectional `core.tool.execute` callbacks validated & committed by Node
   * - Token/clause streaming via `onDelta(textDelta)`
   * - Immediate cancellation via `signal` (AbortSignal) on user barge-in
   */
  async function inferStream({ turnId, text, activeContext, history = [], onDelta, onToolCall, signal, inferTimeoutMs = 10000 }) {
    if (closed || !currentPath || !currentCapability) {
      throw makeFault('BROKER_UNAVAILABLE', 'Local intelligence broker is not paired.', 503);
    }
    if (active >= 12) {
      throw makeFault('BROKER_BUSY', 'Native broker is busy.', 429);
    }
    active++;
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = Buffer.alloc(0);
      const id = randomUUID();
      const socket = net.createConnection({ path: currentPath });
      sockets.add(socket);

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        active--;
        sockets.delete(socket);
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        socket.destroy();
        error ? reject(error) : resolve(result);
      };

      const onAbort = () => {
        try {
          writeFrame(socket, {
            schemaVersion: 1,
            id,
            capability: currentCapability,
            method: 'llm.infer.cancel',
            params: { turnId }
          });
        } catch {}
        finish(makeFault('TURN_INTERRUPTED', 'Turn interrupted by user barge-in.', 499));
      };

      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer = setTimeout(() => finish(makeFault('BROKER_TIMEOUT', 'Local intelligence inference timed out.')), inferTimeoutMs);
      socket.on('error', () => finish(makeFault('BROKER_UNAVAILABLE', 'Local intelligence connection failed.')));
      socket.on('end', () => finish(makeFault('BROKER_UNAVAILABLE', 'Local intelligence socket closed unexpectedly.')));
      socket.on('connect', () => {
        try {
          writeFrame(socket, {
            schemaVersion: 1,
            id,
            capability: currentCapability,
            method: 'llm.infer.start',
            params: { turnId, text, activeContext, history }
          });
        } catch (err) {
          finish(err);
        }
      });

      socket.on('data', async (part) => {
        buffer = Buffer.concat([buffer, part]);
        while (buffer.length >= 4) {
          const length = buffer.readUInt32BE(0);
          if (length <= 0 || length > MAX_FRAME_BYTES) {
            return finish(makeFault('BROKER_FRAME_LIMIT', 'Invalid native broker frame.'));
          }
          if (buffer.length < 4 + length) return;
          const frameBytes = buffer.subarray(4, 4 + length);
          buffer = buffer.subarray(4 + length);
          let frame;
          try {
            frame = decodeStrictJSON(frameBytes);
          } catch {
            return finish(makeFault('BROKER_PROTOCOL', 'Invalid JSON frame from intelligence broker.'));
          }
          if (frame.type === 'llm.infer.delta' && typeof frame.textDelta === 'string') {
            try { onDelta?.(frame.textDelta); } catch {}
          } else if (frame.type === 'core.tool.execute' && onToolCall) {
            try {
              const toolOutput = await onToolCall({
                toolCallId: frame.toolCallId ?? randomUUID(),
                kind: frame.kind,
                args: frame.args ?? {}
              });
              writeFrame(socket, {
                schemaVersion: 1,
                id: frame.rpcId ?? id,
                capability: currentCapability,
                method: 'core.tool.result',
                params: { toolCallId: frame.toolCallId, status: 'ok', output: toolOutput }
              });
            } catch (toolErr) {
              try {
                writeFrame(socket, {
                  schemaVersion: 1,
                  id: frame.rpcId ?? id,
                  capability: currentCapability,
                  method: 'core.tool.result',
                  params: {
                    toolCallId: frame.toolCallId,
                    status: 'error',
                    error: { code: toolErr.code ?? 'TOOL_FAILED', message: toolErr.message ?? 'Tool validation failed.' }
                  }
                });
              } catch {}
            }
          } else if (frame.id === id && frame.error) {
            return finish(makeFault(frame.error.code ?? 'LLM_ERROR', frame.error.message ?? 'Local intelligence failed.', frame.error.status ?? 400));
          } else if (frame.id === id && frame.result) {
            if (typeof frame.result.reply === 'string' && frame.result.reply && !frame.result.streamed) {
              try { onDelta?.(frame.result.reply); } catch {}
            }
            return finish(null, frame.result);
          }
        }
      });
    });
  }

  return {
    get available() {
      return Boolean(currentPath && currentCapability && !closed);
    },
    updateEndpoint,
    call,
    inferStream,
    close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
    }
  };
}
