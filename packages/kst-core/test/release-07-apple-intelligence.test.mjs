import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine } from '../src/engine.mjs';
import { Workspace } from '../src/workspace.mjs';
import { createAppleRuntime } from '../src/apple/runtime.mjs';
import { createNativeBrokerClient } from '../src/apple/broker-client.mjs';
import { createExternalService } from '../src/external.mjs';
import { createRequestHandler } from '../src/http.mjs';
import { ClauseStreamAssembler } from '../src/stream.mjs';

const token = 'test-token-v07-'.repeat(3);

function createMockNativeSocketServer(onFrame) {
  const sockDir = `/private/tmp/kst-${process.getuid()}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  chmodSync(sockDir, 0o700);
  const socketPath = `${sockDir}/b.sock`;
  const capability = 'c'.repeat(44);

  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    const sendFrame = (obj) => {
      const payload = Buffer.from(JSON.stringify(obj), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length, 0);
      socket.write(Buffer.concat([header, payload]));
    };
    socket.on('data', async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (buffer.length < 4 + len) return;
        const raw = buffer.subarray(4, 4 + len);
        buffer = buffer.subarray(4 + len);
        const frame = JSON.parse(raw.toString('utf8'));
        await onFrame(frame, sendFrame, socket);
      }
    });
  });

  return {
    socketPath,
    capability,
    listen: () => new Promise((resolve) => server.listen(socketPath, () => { chmodSync(socketPath, 0o600); resolve(); })),
    close: () => new Promise((resolve) => server.close(() => { rmSync(sockDir, { recursive: true, force: true }); resolve(); }))
  };
}

test('ClauseStreamAssembler splits tokens on prosody boundaries with exact character offsets', () => {
  const clauses = [];
  const assembler = new ClauseStreamAssembler({
    turnId: 'trn_test_1',
    onClause: (c) => clauses.push(c)
  });
  assembler.push('I checked your Apple Calendar: ');
  assembler.push('you have a sync with Sarah at 2 PM. ');
  assembler.push('Would you like me to move it?');
  assembler.flush();

  assert.equal(clauses.length, 3);
  assert.equal(clauses[0].clauseIndex, 0);
  assert.equal(clauses[0].charStart, 0);
  assert.equal(clauses[0].text, 'I checked your Apple Calendar: ');
  assert.equal(clauses[1].charStart, clauses[0].charEnd);
  assert.equal(clauses[1].text, 'you have a sync with Sarah at 2 PM. ');
  assert.equal(clauses[2].charStart, clauses[1].charEnd);
  assert.equal(clauses[2].text, 'Would you like me to move it?');
});

test('v0.7 health, Apple-Native Executive Suite two-stage confirmation, and FoundationModels bidirectional tool loop', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kst-v07-'));
  const mockCalls = [];
  const mockServer = createMockNativeSocketServer(async (frame, sendFrame) => {
    mockCalls.push(frame);
    if (frame.method === 'apple.status') {
      sendFrame({
        id: frame.id,
        result: {
          permissions: { calendar: 'fullAccess', reminders: 'fullAccess', contacts: 'authorized' },
          foundationModelsAvailable: true
        }
      });
    } else if (frame.method === 'apple.execute') {
      const { domain, action, payload } = frame.params;
      if (domain === 'contacts' && action === 'resolveContact') {
        sendFrame({
          id: frame.id,
          result: {
            status: 'ok',
            matches: [{ identifier: 'cn_1', fullName: 'Sarah Jenkins', emails: ['sarah@example.com'], phones: ['+15550199'] }]
          }
        });
      } else if (domain === 'messages' && action === 'sendConfirmedMessage') {
        sendFrame({
          id: frame.id,
          result: { status: 'sent', message: `Sent iMessage to ${payload.recipientName} (${payload.handle}).` }
        });
      } else if (domain === 'safari' && action === 'activeTabContext') {
        sendFrame({
          id: frame.id,
          result: { status: 'ok', title: 'Swift 6 Concurrency Guide', url: 'https://developer.apple.com/swift', excerpt: 'Structured concurrency and actors in Swift 6.' }
        });
      } else if (domain === 'calendar' && action === 'meetingCreate') {
        sendFrame({
          id: frame.id,
          result: { status: 'committed', eventIdentifier: 'ek_evt_777', title: payload.title }
        });
      } else {
        sendFrame({ id: frame.id, result: { status: 'ok' } });
      }
    } else if (frame.method === 'llm.infer.start') {
      // Simulate Apple FoundationModels LanguageModelSession calling a KST tool over native.sock!
      sendFrame({
        type: 'core.tool.execute',
        rpcId: 'tc_call_1',
        parentRpcId: frame.id,
        turnId: frame.params.turnId,
        toolCallId: 'tc_1',
        kind: 'apple.desktop.safariActiveTabContext',
        args: {}
      });
    } else if (frame.method === 'core.tool.result') {
      // After receiving the tool result from Node core, emit streaming deltas and finish
      sendFrame({
        type: 'llm.infer.delta',
        id: frame.id,
        textDelta: 'You are viewing the Swift 6 Concurrency Guide on Apple Developer. '
      });
      sendFrame({
        type: 'llm.infer.delta',
        id: frame.id,
        textDelta: 'It covers structured concurrency and actors.'
      });
      sendFrame({
        id: frame.id,
        result: {
          reply: 'You are viewing the Swift 6 Concurrency Guide on Apple Developer. It covers structured concurrency and actors.',
          streamed: true,
          tierUsed: 'tier1a_foundation_models'
        }
      });
    }
  });

  await mockServer.listen();
  const engine = new Engine(join(dir, 'kst.sqlite'));
  const workspace = new Workspace({ dataDir: dir });
  const external = createExternalService({ dataDir: join(dir, 'external') });
  const broker = createNativeBrokerClient({ socketPath: mockServer.socketPath, capability: mockServer.capability });
  const apple = createAppleRuntime({ dataDir: dir, engine, workspace, broker });
  const handler = createRequestHandler({ engine, workspace, external, apple, broker, token, port: 4310, staticDir: '.' });

  t.after(async () => {
    broker.close();
    apple.close();
    await external.close();
    workspace.close();
    engine.close();
    await mockServer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function request(path, { method = 'GET', body } = {}) {
    const input = body === undefined ? '' : JSON.stringify(body);
    const req = Readable.from(input ? [Buffer.from(input)] : []);
    Object.assign(req, {
      url: path,
      method,
      headers: { host: '127.0.0.1:4310', authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    });
    const chunks = [];
    let status = 0;
    let headers = {};
    await handler(req, {
      writeHead(s, h) { status = s; headers = h; },
      write(chunk) { chunks.push(Buffer.from(chunk)); },
      end(val) { if (val) chunks.push(Buffer.from(val)); }
    });
    const raw = Buffer.concat(chunks).toString('utf8');
    return {
      status,
      headers,
      raw,
      body: headers['Content-Type']?.startsWith('application/json') ? JSON.parse(raw) : null
    };
  }

  // 1. Check /health reports 0.7.0-preview.1 and new capabilities
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.match(health.body.version, /^(?:0\.[78])\.0-preview\.1$/);
  assert.equal(health.body.capabilities.fullDuplexVoice, true);
  assert.equal(health.body.capabilities.bargeIn, true);
  assert.equal(health.body.capabilities.appleNativeSuite, true);

  // 2. Check /api/apple/status
  const appleStat = await request('/api/apple/status');
  assert.equal(appleStat.status, 200);
  assert.equal(appleStat.body.brokerAvailable, true);
  assert.equal(appleStat.body.permissions.calendar, 'fullAccess');

  // 3. Test Two-Stage Outbound iMessage Gate (Turn 1 stages preview; Turn 2 confirms & dispatches)
  const stageMsg = await request('/api/conversation', {
    method: 'POST',
    body: { requestId: 'req-imessage-1', text: 'text Sarah saying Running 5 minutes late' }
  });
  assert.equal(stageMsg.status, 200);
  assert.match(stageMsg.body.reply, /Sarah Jenkins/);
  assert.equal(stageMsg.body.apple.status, 'NEEDS_CONFIRMATION');
  assert.ok(stageMsg.body.apple.confirmationId);

  const confirmMsg = await request('/api/conversation', {
    method: 'POST',
    body: { requestId: 'req-imessage-2', text: 'send it' }
  });
  assert.equal(confirmMsg.status, 200);
  assert.match(confirmMsg.body.reply, /Sent iMessage to Sarah Jenkins/);

  // 4. Test SSE Streaming + FoundationModels bidirectional tool execution + Barge-In truncation
  const sseRes = await request('/api/conversation/stream', {
    method: 'POST',
    body: {
      requestId: 'req-stream-1',
      turnId: 'trn_stream_01',
      text: 'How does my current page relate to concurrency?',
      source: 'voice'
    }
  });
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers['Content-Type'], /text\/event-stream/);
  assert.match(sseRes.raw, /event: tool_preview/);
  assert.match(sseRes.raw, /event: clause/);
  assert.match(sseRes.raw, /Swift 6 Concurrency Guide/);
  assert.match(sseRes.raw, /event: done/);

  // 5. Simulate user barge-in at character 38 of `trn_stream_01`
  const interruptRes = await request('/api/conversation/interrupt', {
    method: 'POST',
    body: {
      requestId: 'req-interrupt-1',
      turnId: 'trn_stream_01',
      spokenCharIndex: 38,
      reason: 'user_barge_in'
    }
  });
  assert.equal(interruptRes.status, 200);
  assert.equal(interruptRes.body.status, 'INTERRUPTED');
  assert.match(interruptRes.body.truncatedText, /\[interrupted by user\]$/);
});
